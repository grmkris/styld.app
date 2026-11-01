import {
  Author,
  type BoardImageId,
  PublicBoard,
  PublicBoardSummary,
  PublicLook,
  NotFound,
  PublicPiece,
  Unavailable,
} from '@styld/protocol'
import { Array, Context, Effect, Option, Schema } from 'effect'
import { shownItem } from '../boards/Parts.ts'
import { type BoardItemRow, type BoardRow, type BoardStore, makeBoardStore } from '../boards/Store.ts'
import { type LookRow, type LookStore, makeLookStore } from '../looks/Store.ts'
import type { Checks } from '../safety/Checks.ts'
import { deliverImage, type ImageBindings } from '../wardrobe/Delivery.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import { shownImage } from '../wardrobe/Shown.ts'
import type { PictureRow, PieceRow } from '../wardrobe/Store.ts'
import type { StoreUnavailable } from '../kernel/Db.ts'
import type { ProfileRow } from './ProfileStore.ts'
import { makePublicStore, type PublicStore } from './PublicStore.ts'
import { makeSocialStore, type SocialStore } from './SocialStore.ts'
import { heldBack, visibleAt } from './Visibility.ts'
import { digestOf } from '../kernel/Ids.ts'

// What others may see. One rule throughout: a thing is shown while its owner's profile is published and shown, its
// owner made it public, and Styld's check of it passed or was unsure (unsure stays on its own links; discovery,
// which comes later, asks for a pass). A piece also needs a picture of its own: a cut-out or a clean drawing, never
// the photo it came from.

const unavailable = () => Unavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)
const notFound = () => NotFound.make({})
const orNotFound = <A>(found: Option.Option<A>) =>
  Option.match(found, { onNone: () => Effect.fail(notFound()), onSome: Effect.succeed })

interface PieceWithPicture {
  readonly piece: PieceRow
  readonly picture: PictureRow | null
}

/** The picture a piece shows others: its cut-out or its clean drawing, never the photo it came from. */
const publicImage = ({ piece, picture }: PieceWithPicture) => {
  const image = shownImage(piece, picture ?? undefined)
  return image.key === piece.originalKey ? Option.none() : Option.some(image)
}

const decoded = <S extends Schema.Top>(schema: S, value: unknown) =>
  // Only Styld's own rows reach here, through the same schemas; a row that does not decode is a bug.
  Schema.decodeUnknownEffect(schema)(value).pipe(Effect.orDie)

const publicPiece = (piece: PieceRow) =>
  decoded(PublicPiece, {
    id: piece.id,
    name: piece.name,
    type: piece.type,
    colours: piece.colours,
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
})

/** What others may see of a board's pins and table, given which pieces and looks they may see. */
interface Seen {
  readonly pieces: ReadonlyMap<string, PublicPiece>
  readonly looks: ReadonlyMap<string, PublicLook>
}

type PinRow = Effect.Success<ReturnType<ReturnType<typeof makeBoardStore>['pinsOf']>>[number]

const publicPins = (seen: Seen, pins: ReadonlyArray<PinRow>): ReadonlyArray<object> =>
  pins.flatMap(({ pin, origin }): ReadonlyArray<object> => {
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
    .map(shownItem)

/** The stores and checks public pages read through. */
interface Reader {
  readonly store: PublicStore
  readonly boards: BoardStore
  readonly looks: LookStore
  readonly social: SocialStore
  readonly checks: Checks['Service']
  /** Who is reading, when signed in: a block either way hides the other's things from them. */
  readonly viewer: Option.Option<string>
}

/** The owner's profile and byline, while others may see the profile. */
const shownProfile = (r: Reader, row: ProfileRow) =>
  Effect.gen(function* () {
    const author = authorOf(row)
    if (Option.isNone(author)) return Option.none<{ readonly row: ProfileRow; readonly author: Author }>()
    const check = (yield* r.checks.statuses('profile', [row.accountId])).get(row.accountId)
    if (!visibleAt('link', check)) return Option.none()
    const reader = Option.getOrNull(r.viewer)
    const blocked =
      reader !== null && reader !== row.accountId && (yield* stored(r.social.blockedBetween(reader, row.accountId)))
    return blocked ? Option.none() : Option.some({ row, author: author.value })
  })
const ownerOf = (r: Reader, accountId: string) =>
  Effect.flatMap(stored(r.store.profileOf(accountId)), (row) =>
    Option.isNone(row) ? Effect.succeed(Option.none()) : shownProfile(r, row.value),
  )

/** Those of the account's pieces others may see, by id. */
const shownPieces = (r: Reader, accountId: string, rows: ReadonlyArray<PieceWithPicture>) =>
  Effect.gen(function* () {
    const ready = rows.filter(
      (row) => row.piece.accountId === accountId && row.piece.status === 'ready' && Option.isSome(publicImage(row)),
    )
    const statuses = yield* r.checks.statuses(
      'piece',
      ready.map(({ piece }) => piece.id),
    )
    const kept = ready.filter(({ piece }) => visibleAt('link', statuses.get(piece.id)))
    const shown = yield* Effect.forEach(kept, ({ piece }) => publicPiece(piece))
    return new Map<string, PublicPiece>(shown.map((piece) => [piece.id, piece]))
  })
const piecesById = (r: Reader, accountId: string, pieceIds: ReadonlyArray<string>) =>
  pieceIds.length === 0
    ? Effect.succeed(new Map<string, PublicPiece>())
    : Effect.flatMap(stored(r.store.pieces([...new Set(pieceIds)])), (rows) => shownPieces(r, accountId, rows))

/** Those of the account's shared looks others may see, each with the pieces others may see. */
const shownLooks = (r: Reader, accountId: string, rows: ReadonlyArray<LookRow>) =>
  Effect.gen(function* () {
    const shared = rows.filter((row) => row.accountId === accountId && row.sharedAt !== null)
    const statuses = yield* r.checks.statuses(
      'look',
      shared.map(({ id }) => id),
    )
    const kept = shared.filter(({ id }) => visibleAt('link', statuses.get(id)))
    const found = yield* stored(r.looks.piecesOf(kept.map(({ id }) => id)))
    const pieces = yield* piecesById(
      r,
      accountId,
      found.map(({ piece }) => piece.id),
    )
    return yield* Effect.forEach(kept, (row) =>
      decoded(PublicLook, {
        id: row.id,
        name: row.name,
        occasion: row.occasion,
        pieces: found.flatMap(({ lookId, piece }) => {
          const shown = lookId === row.id ? pieces.get(piece.id) : undefined
          return shown === undefined ? [] : [shown]
        }),
        sharedAt: (row.sharedAt ?? row.createdAt).toISOString(),
      }),
    )
  })

/** What others may see of these boards' pins and tables. */
const seenOn = (r: Reader, accountId: string, pins: ReadonlyArray<PinRow>, items: ReadonlyArray<BoardItemRow>) =>
  Effect.gen(function* () {
    const pieceIds = [
      ...pins.flatMap(({ pin }) => (pin.pieceId === null ? [] : [pin.pieceId])),
      ...items.flatMap(({ pieceId }) => (pieceId === null ? [] : [pieceId])),
    ]
    const lookIds = [...new Set(pins.flatMap(({ pin }) => (pin.lookId === null ? [] : [pin.lookId])))]
    const looks = lookIds.length === 0 ? [] : yield* shownLooks(r, accountId, yield* stored(r.looks.looksById(lookIds)))
    const seen: Seen = {
      pieces: yield* piecesById(r, accountId, pieceIds),
      looks: new Map<string, PublicLook>(looks.map((look) => [look.id, look])),
    }
    return seen
  })

/** A public board and its owner, while others may see it. */
const shownBoard = (r: Reader, boardId: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.flatMap(stored(r.store.board(boardId)), orNotFound)
    if (row.visibility !== 'public') return yield* notFound()
    const owner = yield* Effect.flatMap(ownerOf(r, row.accountId), orNotFound)
    const check = (yield* r.checks.statuses('board', [row.id])).get(row.id)
    if (!visibleAt('link', check)) return yield* notFound()
    return { row, owner }
  })

const summaries = (r: Reader, accountId: string, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const statuses = yield* r.checks.statuses(
      'board',
      rows.map(({ id }) => id),
    )
    const kept = rows.filter(({ id }) => visibleAt('link', statuses.get(id)))
    const ids = kept.map(({ id }) => id)
    const items = yield* stored(r.boards.itemsOf(ids))
    // Every pin, so a board's count and cover are what others see of it, not what it holds.
    const pins = yield* stored(r.boards.pinsOf(ids))
    const seen = yield* seenOn(r, accountId, pins, items)
    return yield* Effect.forEach(kept, (row) => {
      const shown = publicPins(
        seen,
        pins.filter(({ pin }) => pin.boardId === row.id),
      )
      return decoded(PublicBoardSummary, {
        id: row.id,
        name: row.name,
        paper: row.paper,
        items: publicItems(
          seen,
          items.filter(({ boardId }) => boardId === row.id),
          heldBackImages(pins.filter(({ pin }) => pin.boardId === row.id)),
        ),
        cover: shown.slice(0, 4),
        pinCount: shown.length,
        publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
      })
    })
  })

/** A piece others may see on its own page: it is on one of its owner's public boards or shared looks that others may
 * see. Publishing a profile never shows the whole wardrobe (owner, 2026-10-31). */
const shownPiece = (r: Reader, pieceId: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.flatMap(stored(r.store.pieces([pieceId])), (rows) => orNotFound(Array.head(rows)))
    const owner = yield* Effect.flatMap(ownerOf(r, row.piece.accountId), orNotFound)
    const piece = yield* orNotFound(
      Option.fromNullishOr((yield* shownPieces(r, owner.row.accountId, [row])).get(pieceId)),
    )
    if (!(yield* stored(r.store.onShownBoardOrLook(owner.row.accountId, pieceId)))) return yield* notFound()
    return { row, piece, owner }
  })

/** The same reader, for one visitor. */
const readBy = (r: Reader, viewer: Option.Option<string>): Reader => ({ ...r, viewer })

/** Public boards of any owners as discovery shows them, in the order given: each owner's profile and each board
 * must have passed its check, and no block may stand between owner and reader. */
const discovered = (r: Reader, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const boardChecks = yield* r.checks.statuses(
      'board',
      rows.map(({ id }) => id),
    )
    const owners = [...new Set(rows.map(({ accountId }) => accountId))]
    const profileChecks = yield* r.checks.statuses('profile', owners)
    const found = yield* Effect.forEach(owners, (accountId) =>
      Effect.gen(function* () {
        if (!visibleAt('discovery', profileChecks.get(accountId))) return []
        const owner = yield* ownerOf(r, accountId)
        if (Option.isNone(owner)) return []
        const theirs = rows.filter(
          (row) => row.accountId === accountId && visibleAt('discovery', boardChecks.get(row.id)),
        )
        const shown = yield* summaries(r, accountId, theirs)
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

const pages = (base: Reader) => ({
  profile: Effect.fn('Styld.Public.profile')(function* (handle: string, viewer: Option.Option<string> = Option.none()) {
    const r = readBy(base, viewer)
    const row = yield* Effect.flatMap(stored(r.store.publishedProfile(handle)), orNotFound)
    const { author } = yield* Effect.flatMap(shownProfile(r, row), orNotFound)
    const boards = yield* summaries(r, row.accountId, yield* stored(r.store.publicBoards(row.accountId)))
    const looks = yield* shownLooks(r, row.accountId, yield* stored(r.store.sharedLooks(row.accountId)))
    return {
      ...author,
      city: row.city,
      bio: row.bio,
      boards,
      looks,
      yours: Option.contains(viewer, row.accountId),
    }
  }),
  board: Effect.fn('Styld.Public.board')(function* (boardId: string, viewer: Option.Option<string> = Option.none()) {
    const r = readBy(base, viewer)
    const { row, owner } = yield* shownBoard(r, boardId)
    const items = yield* stored(r.boards.itemsOf([row.id]))
    const pins = yield* stored(r.boards.pinsOf([row.id]))
    const seen = yield* seenOn(r, row.accountId, pins, items)
    return yield* decoded(PublicBoard, {
      id: row.id,
      name: row.name,
      paper: row.paper,
      items: publicItems(seen, items, heldBackImages(pins)),
      pins: publicPins(seen, pins),
      by: owner.author,
      publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
    })
  }),
  look: Effect.fn('Styld.Public.look')(function* (lookId: string, viewer: Option.Option<string> = Option.none()) {
    const r = readBy(base, viewer)
    const row = yield* Effect.flatMap(stored(r.store.look(lookId)), orNotFound)
    const owner = yield* Effect.flatMap(ownerOf(r, row.accountId), orNotFound)
    const [look] = yield* shownLooks(r, row.accountId, [row])
    return { look: yield* orNotFound(Option.fromNullishOr(look)), by: owner.author }
  }),
  /** Boards for Explore and search, gated as discovery is. */
  discover: (rows: ReadonlyArray<BoardRow>, viewer: Option.Option<string>) => discovered(readBy(base, viewer), rows),
  /** A person others may find, with their profile's row: a published profile whose check passed, with no block in
   * between. */
  findable: (accountId: string, viewer: Option.Option<string>) =>
    Effect.gen(function* () {
      const r = readBy(base, viewer)
      if (!visibleAt('discovery', (yield* r.checks.statuses('profile', [accountId])).get(accountId)))
        return Option.none()
      return yield* ownerOf(r, accountId)
    }),
  piece: Effect.fn('Styld.Public.piece')(function* (pieceId: string, viewer: Option.Option<string> = Option.none()) {
    const { piece, owner } = yield* shownPiece(readBy(base, viewer), pieceId)
    return { piece, by: owner.author, yours: Option.contains(viewer, owner.row.accountId) }
  }),
})

const images = (
  r: Reader,
  bindings: ImageBindings,
  versionOf: (key: string, size: ImageSize) => Effect.Effect<string, Unavailable>,
) => {
  const delivered = (
    source: { readonly key: string; readonly contentType: string },
    size: ImageSize,
    version: string,
  ) =>
    Effect.map(deliverImage(bindings, source, size, { fallback: 'none' }), (image) =>
      Option.map(image, (shown): ShownImage => ({ ...shown, version })),
    )
  return {
    /** A public piece's picture, re-encoded by the Images binding; a failed transform shows none. */
    pieceImage: Effect.fn('Styld.Public.pieceImage')(function* (pieceId: string, size: ImageSize) {
      const shown = yield* shownPiece(r, pieceId).pipe(Effect.option)
      if (Option.isNone(shown)) return Option.none<ShownImage>()
      const image = publicImage(shown.value.row)
      if (Option.isNone(image)) return Option.none<ShownImage>()
      return yield* delivered(image.value, size, yield* versionOf(image.value.key, size))
    }),
    /** A picture on a public board others may see. A picture never changes, so its id and size are its version. */
    pictureImage: Effect.fn('Styld.Public.pictureImage')(function* (imageId: BoardImageId, size: ImageSize) {
      const image = yield* stored(r.store.image(imageId))
      // An outfit photo of My Gallery is never shown to anyone but its owner.
      if (Option.isNone(image) || heldBack(image.value.origin)) return Option.none<ShownImage>()
      const board = yield* shownBoard(r, image.value.boardId).pipe(Effect.option)
      if (Option.isNone(board)) return Option.none<ShownImage>()
      const { objectKey, contentType } = image.value
      return yield* delivered({ key: objectKey, contentType }, size, `${imageId}.${size}`)
    }),
  }
}

const make = (
  bindings: ImageBindings & { readonly database: Parameters<typeof makePublicStore>[0] },
  checks: Checks['Service'],
) =>
  Effect.sync(() => {
    const r: Reader = {
      store: makePublicStore(bindings.database),
      boards: makeBoardStore(bindings.database),
      looks: makeLookStore(bindings.database),
      social: makeSocialStore(bindings.database),
      checks,
      // Pictures are not gated by blocks: their ids are random, and every page that names one applies blocks.
      viewer: Option.none(),
    }
    return { ...pages(r), ...images(r, bindings, versionOf) }
  })

/** Public pages: what anyone may read, signed in or not. */
export class PublicPages extends Context.Service<PublicPages, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/PublicPages',
) {}

/** A public picture's version: a digest of its stored key, so a changed picture is a new address. */
const versionOf = (key: string, size: ImageSize) =>
  Effect.map(digestOf(key), (digest) => `${digest.slice(0, 22)}.${size}`)

/** Public pages over the Worker's bindings, by the Worker's checks. Build it once per isolate. */
export const makePublicPages = (
  bindings: ImageBindings & { readonly database: Parameters<typeof makePublicStore>[0] },
  checks: Checks['Service'],
) => Effect.map(make(bindings, checks), (service) => PublicPages.of(service))
