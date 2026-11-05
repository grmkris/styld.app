import {
  Author,
  type BoardImageId,
  PublicBoard,
  PublicBoardSummary,
  PublicLook,
  NotFound,
  PublicPiece,
} from '@styld/protocol'
import { Array, Context, Effect, Layer, Option, Schema } from 'effect'
import { shownItem } from '../boards/Shared.ts'
import { type BoardItemRow, type BoardRow, BoardStore, type PinRow } from '../boards/Store.ts'
import { type LookRow, LookStore } from '../looks/Store.ts'
import { Checks } from '../safety/Checks.ts'
import { deliverImage } from '../wardrobe/Delivery.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import type { PieceRow } from '../wardrobe/Store.ts'
import { Database, stored } from '../kernel/Db.ts'
import { Media } from '../kernel/Media.ts'
import { profilesOf, type ProfileRow } from './ProfileStore.ts'
import { PublicStore } from './PublicStore.ts'
import { SocialStore } from './SocialStore.ts'
import { heldBack, type PieceWithPicture, publicImage, visibleAt } from './Visibility.ts'
import { digestOf } from '../kernel/Ids.ts'
import { boardTranslationsIn, profileTranslationsIn, ReaderLocale, translatedItems } from './Translated.ts'

// What others may see. One rule throughout: a thing is shown while its owner's profile is published and shown, its
// owner made it public, and Styld's check of it passed or was unsure (unsure stays on its own links; discovery,
// which comes later, asks for a pass). A piece also needs a picture of its own: a cut-out or a clean drawing, never
// the photo it came from.

const notFound = () => NotFound.make({})
const orNotFound = <A>(found: Option.Option<A>) =>
  Option.match(found, { onNone: () => Effect.fail(notFound()), onSome: Effect.succeed })

const decoded = <S extends Schema.Top>(schema: S, value: unknown) =>
  // Only Styld's own rows reach here, through the same schemas; a row that does not decode is a bug.
  Schema.decodeUnknownEffect(schema)(value).pipe(Effect.orDie)

const publicPiece = (piece: PieceRow, generated: boolean) =>
  decoded(PublicPiece, {
    id: piece.id,
    name: piece.name,
    type: piece.type,
    colours: piece.colours,
    generated,
  })

export const authorOf = (row: ProfileRow): Option.Option<Author> =>
  row.published
    ? Schema.decodeUnknownOption(Author)({ handle: row.handle, name: row.name, tone: row.tone })
    : Option.none()

/** A public board as a list shows it: its table, its newest pins and how many. */
export const summaryOf = (board: PublicBoard): PublicBoardSummary => ({
  id: board.id,
  name: board.name,
  paper: board.paper,
  items: board.items,
  cover: board.pins.slice(0, 4),
  pinCount: board.pins.length,
  publishedAt: board.publishedAt,
  generated: board.generated,
})

/** What others may see of a board's pins and table, given which pieces and looks they may see. */
interface Seen {
  readonly pieces: ReadonlyMap<string, PublicPiece>
  readonly looks: ReadonlyMap<string, PublicLook>
  /** Which of the pieces on the boards, seen or not yet, are house garments Styld generated. */
  readonly generated: ReadonlySet<string>
}

/** A pin as others see it, to be decoded with its board. */
type ShownPin = { readonly id: string; readonly [field: string]: unknown }

const publicPins = (seen: Seen, pins: ReadonlyArray<PinRow>): ReadonlyArray<ShownPin> =>
  pins.flatMap(({ pin, origin }): ReadonlyArray<ShownPin> => {
    const base = { id: pin.id, addedAt: pin.createdAt.toISOString() }
    const piece = pin.pieceId === null ? undefined : seen.pieces.get(pin.pieceId)
    const look = pin.lookId === null ? undefined : seen.looks.get(pin.lookId)
    if (pin.kind === 'piece' && piece !== undefined) return [{ _tag: 'PublicPiecePin', ...base, piece }]
    // An outfit photo of My Gallery is held back from visitors.
    if (pin.kind === 'picture' && pin.imageId !== null && !heldBack(origin))
      return [{ _tag: 'PublicPicturePin', ...base, imageId: pin.imageId, generated: origin === 'generated' }]
    if (pin.kind === 'look' && look !== undefined) return [{ _tag: 'PublicLookPin', ...base, look }]
    return []
  })

/** The board's outfit photos (My Gallery), which visitors never see on its pins or its table. */
const heldBackImages = (pins: ReadonlyArray<PinRow>): ReadonlySet<string> =>
  new Set(pins.flatMap(({ pin, origin }) => (heldBack(origin) && pin.imageId !== null ? [pin.imageId] : [])))

/** The table without the pieces others may not see, nor the outfit photos; its other pictures and labels are the
 * board's, checked with it. */
const publicItems = (seen: Seen, items: ReadonlyArray<BoardItemRow>, held: ReadonlySet<string>) =>
  items
    .filter((item) => item.kind !== 'piece' || (item.pieceId !== null && seen.pieces.has(item.pieceId)))
    .filter((item) => item.kind !== 'image' || item.imageId === null || !held.has(item.imageId))
    .map((item) => shownItem(item))

/** The stores and checks public pages read through, provided once by the `PublicPages` layer. */
type PublicServices = Database | PublicStore | BoardStore | LookStore | SocialStore | Checks | Media

/** Who is reading, when signed in: a block either way hides the other's things from them. */
type Viewer = Option.Option<string>

/** A profile as others see it: its row, its byline and bio in the reader's language where translated. */
interface ShownProfile {
  readonly row: ProfileRow
  readonly author: Author
  readonly bio: string | null
}

/** The owners' profiles others may see, by account, each with its byline and bio in the reader's language: one read
 * of each kind for them all. */
const shownProfiles = (viewer: Viewer, rows: ReadonlyArray<ProfileRow>) =>
  Effect.gen(function* () {
    const published = rows.flatMap((row) => Option.toArray(Option.map(authorOf(row), (author) => ({ row, author }))))
    const checks = yield* (yield* Checks).statuses(
      'profile',
      published.map(({ row }) => row.accountId),
    )
    const visible = published.filter(({ row }) => visibleAt('link', checks.get(row.accountId)))
    const reader = Option.getOrNull(viewer)
    const others = visible.map(({ row }) => row.accountId).filter((accountId) => accountId !== reader)
    const blocked =
      reader === null || others.length === 0
        ? new Set<string>()
        : yield* stored((yield* SocialStore).blockedAmong(reader, others))
    const shown = visible.filter(({ row }) => !blocked.has(row.accountId))
    const translations = yield* stored(
      profileTranslationsIn(
        yield* Database,
        yield* ReaderLocale,
        shown.map(({ row }) => row),
      ),
    )
    return new Map(
      shown.map(({ row, author }): [string, ShownProfile] => {
        const translated = translations.get(row.accountId)
        return [
          row.accountId,
          {
            row,
            author: translated === undefined ? author : { ...author, name: translated.name },
            bio: translated?.bio ?? row.bio,
          },
        ]
      }),
    )
  })

/** The owner's profile and byline, while others may see the profile. */
const shownProfile = (viewer: Viewer, row: ProfileRow) =>
  Effect.map(shownProfiles(viewer, [row]), (shown) => Option.fromNullishOr(shown.get(row.accountId)))

/** The owners others may see, by account. */
const ownersOf = (viewer: Viewer, accountIds: ReadonlyArray<string>) =>
  Effect.flatMap(stored(Effect.flatMap(Database, (db) => profilesOf(db, [...new Set(accountIds)]))), (rows) =>
    shownProfiles(viewer, rows),
  )
const ownerOf = (viewer: Viewer, accountId: string) =>
  Effect.map(ownersOf(viewer, [accountId]), (owners) => Option.fromNullishOr(owners.get(accountId)))

/** A thing others may see, with the account it is whose. */
interface Owned<A> {
  readonly owner: string
  readonly value: A
}

/** Of things others may see, those of one owner, by id. */
const ownedBy = <A>(things: ReadonlyMap<string, Owned<A>>, owner: string): ReadonlyMap<string, A> =>
  new Map([...things].flatMap(([id, thing]) => (thing.owner === owner ? [[id, thing.value] as const] : [])))

/** Those of the owners' pieces others may see, by id. */
const shownPieces = (owners: ReadonlySet<string>, rows: ReadonlyArray<PieceWithPicture>) =>
  Effect.gen(function* () {
    const ready = rows.filter(
      (row) => owners.has(row.piece.accountId) && row.piece.status === 'ready' && Option.isSome(publicImage(row)),
    )
    const statuses = yield* (yield* Checks).statuses(
      'piece',
      ready.map(({ piece }) => piece.id),
    )
    const kept = ready.filter(({ piece }) => visibleAt('link', statuses.get(piece.id)))
    const generated = yield* stored((yield* PublicStore).generatedAmong(kept.map(({ piece }) => piece.id)))
    const shown = yield* Effect.forEach(kept, ({ piece }) =>
      Effect.map(publicPiece(piece, generated.has(piece.id)), (value): [string, Owned<PublicPiece>] => [
        piece.id,
        { owner: piece.accountId, value },
      ]),
    )
    return new Map(shown)
  })
const piecesById = (owners: ReadonlySet<string>, pieceIds: ReadonlyArray<string>) =>
  pieceIds.length === 0
    ? Effect.succeed(new Map<string, Owned<PublicPiece>>())
    : Effect.flatMap(stored(Effect.flatMap(PublicStore, (store) => store.pieces([...new Set(pieceIds)]))), (rows) =>
        shownPieces(owners, rows),
      )

/** Those of the owners' shared looks others may see, each with the pieces of its owner others may see. */
const shownLooks = (owners: ReadonlySet<string>, rows: ReadonlyArray<LookRow>) =>
  Effect.gen(function* () {
    const shared = rows.filter((row) => owners.has(row.accountId) && row.sharedAt !== null)
    const statuses = yield* (yield* Checks).statuses(
      'look',
      shared.map(({ id }) => id),
    )
    const kept = shared.filter(({ id }) => visibleAt('link', statuses.get(id)))
    const found = yield* stored((yield* LookStore).piecesOf(kept.map(({ id }) => id)))
    const pieces = yield* piecesById(
      owners,
      found.map(({ piece }) => piece.id),
    )
    return yield* Effect.forEach(kept, (row) => {
      const its = found.flatMap(({ lookId, piece }) => {
        const shown = lookId === row.id ? pieces.get(piece.id) : undefined
        return shown === undefined || shown.owner !== row.accountId ? [] : [shown.value]
      })
      return Effect.map(
        decoded(PublicLook, {
          id: row.id,
          name: row.name,
          occasion: row.occasion,
          pieces: its,
          sharedAt: (row.sharedAt ?? row.createdAt).toISOString(),
          generated: its.some(({ generated }) => generated),
        }),
        (value): Owned<PublicLook> => ({ owner: row.accountId, value }),
      )
    })
  })

/** Those of the account's shared looks others may see. */
const looksOf = (accountId: string, rows: ReadonlyArray<LookRow>) =>
  Effect.map(shownLooks(new Set([accountId]), rows), (looks) => looks.map(({ value }) => value))

/** What others may see of the owners' pins and tables, each with whose it is. */
interface SeenAmong {
  readonly pieces: ReadonlyMap<string, Owned<PublicPiece>>
  readonly looks: ReadonlyMap<string, Owned<PublicLook>>
  readonly generated: ReadonlySet<string>
}

/** What others may see of these boards' pins and tables, the boards of any of `owners`. */
const seenAmong = (owners: ReadonlySet<string>, pins: ReadonlyArray<PinRow>, items: ReadonlyArray<BoardItemRow>) =>
  Effect.gen(function* () {
    const pieceIds = [
      ...pins.flatMap(({ pin }) => (pin.pieceId === null ? [] : [pin.pieceId])),
      ...items.flatMap(({ pieceId }) => (pieceId === null ? [] : [pieceId])),
    ]
    const lookIds = [...new Set(pins.flatMap(({ pin }) => (pin.lookId === null ? [] : [pin.lookId])))]
    const looks =
      lookIds.length === 0 ? [] : yield* shownLooks(owners, yield* stored((yield* LookStore).looksById(lookIds)))
    const seen: SeenAmong = {
      pieces: yield* piecesById(owners, pieceIds),
      looks: new Map(looks.map((look) => [look.value.id, look])),
      generated: yield* stored((yield* PublicStore).generatedAmong([...new Set(pieceIds)])),
    }
    return seen
  })

/** What others may see of one owner's boards' pins and tables. */
const seenBy = (seen: SeenAmong, owner: string): Seen => ({
  pieces: ownedBy(seen.pieces, owner),
  looks: ownedBy(seen.looks, owner),
  generated: seen.generated,
})

/** What others may see of the account's boards' pins and tables. */
const seenOn = (accountId: string, pins: ReadonlyArray<PinRow>, items: ReadonlyArray<BoardItemRow>) =>
  Effect.map(seenAmong(new Set([accountId]), pins, items), (seen) => seenBy(seen, accountId))

/** Whether the board holds a generated piece: pinned, on its table, or in a look pinned on it. It is marked so
 * whatever others may see of the piece yet: a piece still being checked is generated all the same. */
const showsGenerated = (seen: Seen, pins: ReadonlyArray<PinRow>, items: ReadonlyArray<BoardItemRow>) =>
  [...pins.map(({ pin }) => pin.pieceId), ...items.map(({ pieceId }) => pieceId)].some(
    (id) => id !== null && seen.generated.has(id),
  ) || pins.some(({ pin }) => pin.lookId !== null && seen.looks.get(pin.lookId)?.generated === true)

/** A public board and its owner, while others may see it. */
const shownBoard = (viewer: Viewer, boardId: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.flatMap(stored((yield* PublicStore).board(boardId)), orNotFound)
    if (row.visibility !== 'public') return yield* notFound()
    const owner = yield* Effect.flatMap(ownerOf(viewer, row.accountId), orNotFound)
    const check = (yield* (yield* Checks).statuses('board', [row.id])).get(row.id)
    if (!visibleAt('link', check)) return yield* notFound()
    return { row, owner }
  })

/** The boards' translations into the reader's language that still translate their names and labels. */
const translationsOf = (rows: ReadonlyArray<BoardRow>, items: ReadonlyArray<BoardItemRow>) =>
  Effect.gen(function* () {
    const words = rows.map((row) => ({
      id: row.id,
      name: row.name,
      labels: items.flatMap(({ boardId, id, text }) => (boardId === row.id && text !== null ? [{ id, text }] : [])),
    }))
    return yield* stored(boardTranslationsIn(yield* Database, yield* ReaderLocale, words))
  })

const summaries = (accountId: string, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const statuses = yield* (yield* Checks).statuses(
      'board',
      rows.map(({ id }) => id),
    )
    const kept = rows.filter(({ id }) => visibleAt('link', statuses.get(id)))
    const ids = kept.map(({ id }) => id)
    const items = yield* stored((yield* BoardStore).itemsOf(ids))
    // Every pin, so a board's count and cover are what others see of it, not what it holds.
    const pins = yield* stored((yield* BoardStore).pinsOf(ids))
    const seen = yield* seenOn(accountId, pins, items)
    const translations = yield* translationsOf(kept, items)
    return yield* Effect.forEach(kept, (row) => {
      const shown = publicPins(
        seen,
        pins.filter(({ pin }) => pin.boardId === row.id),
      )
      const translated = translations.get(row.id)
      return decoded(PublicBoardSummary, {
        id: row.id,
        name: translated?.name ?? row.name,
        paper: row.paper,
        items: translatedItems(
          publicItems(
            seen,
            items.filter(({ boardId }) => boardId === row.id),
            heldBackImages(pins.filter(({ pin }) => pin.boardId === row.id)),
          ),
          translated?.labels,
        ),
        cover: shown.slice(0, 4),
        pinCount: shown.length,
        publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
        generated: showsGenerated(
          seen,
          pins.filter(({ pin }) => pin.boardId === row.id),
          items.filter(({ boardId }) => boardId === row.id),
        ),
      })
    })
  })

/** These public boards as their pages show them to this reader, by id: a board the reader may not see is not there.
 * One read of each kind for them all, so a page of the feed reads its boards at once. */
const shownBoards = (viewer: Viewer, boardIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (boardIds.length === 0) return new Map<string, PublicBoard>()
    const rows = (yield* stored((yield* PublicStore).boards([...new Set(boardIds)]))).filter(
      (row) => row.visibility === 'public',
    )
    const owners = yield* ownersOf(
      viewer,
      rows.map(({ accountId }) => accountId),
    )
    const checks = yield* (yield* Checks).statuses(
      'board',
      rows.map(({ id }) => id),
    )
    const kept = rows.filter((row) => owners.has(row.accountId) && visibleAt('link', checks.get(row.id)))
    const ids = kept.map(({ id }) => id)
    const items = yield* stored((yield* BoardStore).itemsOf(ids))
    const pins = yield* stored((yield* BoardStore).pinsOf(ids))
    const seenAll = yield* seenAmong(new Set(kept.map(({ accountId }) => accountId)), pins, items)
    const translations = yield* translationsOf(kept, items)
    const shown = yield* Effect.forEach(kept, (row) => {
      const its = {
        items: items.filter(({ boardId }) => boardId === row.id),
        pins: pins.filter(({ pin }) => pin.boardId === row.id),
      }
      const seen = seenBy(seenAll, row.accountId)
      const translated = translations.get(row.id)
      return decoded(PublicBoard, {
        id: row.id,
        name: translated?.name ?? row.name,
        paper: row.paper,
        items: translatedItems(publicItems(seen, its.items, heldBackImages(its.pins)), translated?.labels),
        pins: publicPins(seen, its.pins),
        by: owners.get(row.accountId)?.author,
        publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
        generated: showsGenerated(seen, its.pins, its.items),
      })
    })
    return new Map(shown.map((board) => [board.id, board]))
  })

/** These shared looks as their pages show them to this reader, with their owners' bylines, by id: a look the reader
 * may not see is not there. One read of each kind for them all. */
const shownLooksById = (viewer: Viewer, lookIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (lookIds.length === 0) return new Map<string, { readonly look: PublicLook; readonly by: Author }>()
    const rows = yield* stored((yield* LookStore).looksById([...new Set(lookIds)]))
    const owners = yield* ownersOf(
      viewer,
      rows.map(({ accountId }) => accountId),
    )
    const looks = yield* shownLooks(new Set(owners.keys()), rows)
    return new Map(
      looks.flatMap(({ owner, value }) => {
        const by = owners.get(owner)
        return by === undefined ? [] : [[value.id, { look: value, by: by.author }] as const]
      }),
    )
  })

/** A piece others may see on its own page: it is on one of its owner's public boards or shared looks that others may
 * see. Publishing a profile never shows the whole wardrobe (owner, 2026-10-31). */
const shownPiece = (viewer: Viewer, pieceId: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.flatMap(stored((yield* PublicStore).pieces([pieceId])), (rows) =>
      orNotFound(Array.head(rows)),
    )
    const owner = yield* Effect.flatMap(ownerOf(viewer, row.piece.accountId), orNotFound)
    const shown = (yield* shownPieces(new Set([owner.row.accountId]), [row])).get(pieceId)
    const piece = yield* orNotFound(Option.fromNullishOr(shown?.value))
    if (!(yield* stored((yield* PublicStore).onShownBoardOrLook(owner.row.accountId, pieceId))))
      return yield* notFound()
    return { row, piece, owner }
  })

/** Public boards of any owners as discovery shows them, in the order given: each owner's profile and each board
 * must have passed its check, and no block may stand between owner and reader. */
const discovered = (viewer: Viewer, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const boardChecks = yield* (yield* Checks).statuses(
      'board',
      rows.map(({ id }) => id),
    )
    const owners = [...new Set(rows.map(({ accountId }) => accountId))]
    const profileChecks = yield* (yield* Checks).statuses('profile', owners)
    const found = yield* Effect.forEach(owners, (accountId) =>
      Effect.gen(function* () {
        if (!visibleAt('discovery', profileChecks.get(accountId))) return []
        const owner = yield* ownerOf(viewer, accountId)
        if (Option.isNone(owner)) return []
        const theirs = rows.filter(
          (row) => row.accountId === accountId && visibleAt('discovery', boardChecks.get(row.id)),
        )
        const shown = yield* summaries(accountId, theirs)
        return shown.map((board) => ({
          board,
          by: owner.value.author,
          moods: theirs.find(({ id }) => id === board.id)?.moods ?? [],
        }))
      }),
    )
    const byId = new Map(found.flat().map((entry): [string, (typeof found)[number][number]] => [entry.board.id, entry]))
    return rows.flatMap(({ id }) => {
      const entry = byId.get(id)
      return entry === undefined ? [] : [entry]
    })
  })

const pages = Effect.map(Effect.context<PublicServices>(), (context) => ({
  profile: Effect.fn('Styld.Public.profile')(function* (handle: string, viewer: Option.Option<string> = Option.none()) {
    const store = yield* PublicStore
    const row = yield* Effect.flatMap(stored(store.publishedProfile(handle)), orNotFound)
    const { author, bio } = yield* Effect.flatMap(shownProfile(viewer, row), orNotFound)
    const boards = yield* summaries(row.accountId, yield* stored(store.publicBoards(row.accountId)))
    const looks = yield* looksOf(row.accountId, yield* stored(store.sharedLooks(row.accountId)))
    return {
      ...author,
      city: row.city,
      bio,
      boards,
      looks,
      yours: Option.contains(viewer, row.accountId),
    }
  }, Effect.provide(context)),
  board: Effect.fn('Styld.Public.board')(function* (boardId: string, viewer: Option.Option<string> = Option.none()) {
    return yield* orNotFound(Option.fromNullishOr((yield* shownBoards(viewer, [boardId])).get(boardId)))
  }, Effect.provide(context)),
  look: Effect.fn('Styld.Public.look')(function* (lookId: string, viewer: Option.Option<string> = Option.none()) {
    return yield* orNotFound(Option.fromNullishOr((yield* shownLooksById(viewer, [lookId])).get(lookId)))
  }, Effect.provide(context)),
  /** The boards and looks of a page of the feed as their pages show them to this reader, all read at once: one the
   * reader may not see is not there, and a store that does not answer fails the page. */
  feed: Effect.fn('Styld.Public.feed')(function* (
    boardIds: ReadonlyArray<string>,
    lookIds: ReadonlyArray<string>,
    viewer: Option.Option<string>,
  ) {
    return { boards: yield* shownBoards(viewer, boardIds), looks: yield* shownLooksById(viewer, lookIds) }
  }, Effect.provide(context)),
  /** Boards for Explore and search, gated as discovery is. */
  discover: (rows: ReadonlyArray<BoardRow>, viewer: Viewer) => discovered(viewer, rows).pipe(Effect.provide(context)),
  /** A person others may find, with their profile's row: a published profile whose check passed, with no block in
   * between. */
  findable: (accountId: string, viewer: Viewer) =>
    Effect.gen(function* () {
      if (!visibleAt('discovery', (yield* (yield* Checks).statuses('profile', [accountId])).get(accountId)))
        return Option.none()
      return yield* ownerOf(viewer, accountId)
    }).pipe(Effect.provide(context)),
  piece: Effect.fn('Styld.Public.piece')(function* (pieceId: string, viewer: Option.Option<string> = Option.none()) {
    const { piece, owner } = yield* shownPiece(viewer, pieceId)
    return { piece, by: owner.author, yours: Option.contains(viewer, owner.row.accountId) }
  }, Effect.provide(context)),
}))

/** A public picture's version: a digest of its stored key, so a changed picture is a new address. */
const versionOf = (key: string, size: ImageSize, rotation: PieceRow['rotation']) =>
  Effect.map(digestOf(`${key}:${String(rotation)}`), (digest) => `${digest.slice(0, 22)}.${size}`)

/** A stored picture as others get it: re-encoded, or none when the transform fails. */
const delivered = (
  source: { readonly key: string; readonly contentType: string; readonly rotation?: PieceRow['rotation'] },
  size: ImageSize,
  version: string,
) =>
  Effect.map(
    Effect.flatMap(Media, (media) =>
      deliverImage(media, source, size, { fallback: 'none', rotation: source.rotation }),
    ),
    (image) => Option.map(image, (shown): ShownImage => ({ ...shown, version })),
  )

const images = Effect.map(Effect.context<PublicServices>(), (context) => ({
  /** A public piece's picture, re-encoded by the Images binding; a failed transform shows none. */
  pieceImage: Effect.fn('Styld.Public.pieceImage')(function* (pieceId: string, size: ImageSize) {
    // Pictures are not gated by blocks: their ids are random, and every page that names one applies blocks.
    const shown = yield* shownPiece(Option.none(), pieceId).pipe(Effect.option)
    if (Option.isNone(shown)) return Option.none<ShownImage>()
    const image = publicImage(shown.value.row)
    if (Option.isNone(image)) return Option.none<ShownImage>()
    // The owner's rotation turns their cut-out, never a drawing (`shownImage`).
    return yield* delivered(image.value, size, yield* versionOf(image.value.key, size, image.value.rotation))
  }, Effect.provide(context)),
  /** A picture on a public board others may see. A picture never changes, so its id and size are its version. */
  pictureImage: Effect.fn('Styld.Public.pictureImage')(function* (imageId: BoardImageId, size: ImageSize) {
    const image = yield* stored((yield* PublicStore).image(imageId))
    // An outfit photo of My Gallery is never shown to anyone but its owner.
    if (Option.isNone(image) || heldBack(image.value.origin)) return Option.none<ShownImage>()
    const board = yield* shownBoard(Option.none(), image.value.boardId).pipe(Effect.option)
    if (Option.isNone(board)) return Option.none<ShownImage>()
    const { objectKey, contentType } = image.value
    return yield* delivered({ key: objectKey, contentType }, size, `${imageId}.${size}`)
  }, Effect.provide(context)),
}))

/** What the owner of a board reads about who sees its pins. */
const owners = Effect.map(Effect.context<PublicServices>(), (context) => ({
  /** Which of these pins of the account's boards others see once their board is public: the pieces and looks others
   * may see past their checks and the pictures that are not held back; the owner's board page marks the rest. */
  pinsShown: Effect.fn('Styld.Public.pinsShown')(function* (accountId: string, pins: ReadonlyArray<PinRow>) {
    const seen = yield* seenOn(accountId, pins, [])
    return new Set(publicPins(seen, pins).map(({ id }) => id))
  }, Effect.provide(context)),
}))

/** Every public read, each group built over the services it yields (`PublicServices`). */
const make = Effect.gen(function* () {
  return { ...(yield* pages), ...(yield* images), ...(yield* owners) }
})

/** Public pages: what anyone may read, signed in or not, by the one visibility rule. */
export class PublicPages extends Context.Service<PublicPages, Effect.Success<typeof make>>()(
  '@styld/server/social/PublicPages',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => PublicPages.of(service)),
  ).pipe(Layer.provide([PublicStore.layer, SocialStore.layer, LookStore.layer]))
}
