import {
  BoardId,
  CurrentAccount,
  CurrentOperator,
  NotFound,
  OperationConflict,
  type OperationId,
  PieceId,
  type RemoveSeededBoard,
  type SeedBoardRequest,
  type SeedBoardStatus,
  type SeedProfile,
  SeedRefused,
  Unavailable,
} from '@styld/protocol'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { Boards } from '../boards/Boards.ts'
import { Deployment } from '../Config.ts'
import { ImportStore } from '../imports/Store.ts'
import { Database, nowDate, query, StoreUnavailable } from '../kernel/Db.ts'
import { digestOf } from '../kernel/Ids.ts'
import { wearablesOf } from '../outfits/Wearables.ts'
import { Curation } from '../social/Curation.ts'
import { profileTranslationWrite } from '../social/ProfileStore.ts'
import { Profiles } from '../social/Profiles.ts'
import { profileSourceDigest } from '../social/Translated.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { createdBoard, digestsOf, forgetSteps, planOf, stepOf, updatedBoard } from './Boarding.ts'
import { seedPrefix, SeedStore } from './Store.ts'

// The operator's seeding of the house inspiration boards (owner, 4 November 2026; `tools/seed/`). Only the configured
// house accounts (`STYLD_HOUSE_EMAILS`) are written to, each by its email, and everything is done as that account
// through the app's own services: its profile by `Profiles`, its boards by `Boards`, its house mark by `Curation`. A
// catalogue entry becomes one board for good (`seeded_boards`): the same entry again changes nothing, a changed one
// changes the same board. Its garments must be imported, ready and cut out; otherwise the entry is refused and named.

/** A store that does not answer: the seed is unavailable. */
const stored = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.mapError(effect, () => Unavailable.make({}))

/** The house account an email signs in to: only a configured house email, and only an account that exists. */
const houseAccount = Effect.fnUntraced(function* (email: string) {
  const { house } = yield* Deployment
  if (!house.has(email.trim().toLowerCase())) return yield* SeedRefused.make({ reason: 'notHouse', detail: [] })
  const found = yield* stored((yield* ImportStore).accountOf(email))
  if (Option.isNone(found)) return yield* NotFound.make({})
  return found.value.accountId
})

/** Act as the house account, as the generation job acts for the person who asked (`generation/Work.ts`). */
const as = (accountId: string) => Effect.provideService(CurrentAccount, { accountId, via: 'assistant' })

type GarmentRow = Effect.Success<ReturnType<SeedStore['Service']['houseGarments']>>[number]

/** Whether a house garment can go on a board: ready and cut out. Clef's reading of it is reported, never a reason to
 * hold its boards (owner, 4 November 2026: the catalogue's type stands, and every garment passed the seed's own judge
 * as one whole garment of that type and colour). */
const usable = (row: GarmentRow) => row.status === 'ready' && row.imageKey !== null && row.imageKey !== row.originalKey

/** The account's house garments by manifest id. */
const garmentsOf = (accountId: string) =>
  Effect.map(stored(Effect.flatMap(SeedStore, (store) => store.houseGarments(accountId))), (rows) =>
    rows.map((row) => ({ ...row, manifestId: row.v1Id.slice(seedPrefix.length) })),
  )

/** The entry's garments as the outfit rules read them, by manifest id; any not usable refuses the entry by name. */
const wearablesFor = Effect.fnUntraced(function* (accountId: string, request: SeedBoardRequest) {
  const named = [...request.board.pieces, ...(request.board.anchor === undefined ? [] : [request.board.anchor])]
  const rows = new Map((yield* garmentsOf(accountId)).map((row) => [row.manifestId, row]))
  const missing = named.filter((id) => {
    const row = rows.get(id)
    return row === undefined || !usable(row)
  })
  if (missing.length > 0) return yield* SeedRefused.make({ reason: 'piecesMissing', detail: missing })
  const owned = yield* stored(wearablesOf(yield* WardrobeStore, accountId))
  const byPiece = new Map(owned.map(({ wearable }) => [wearable.id, wearable]))
  return new Map(
    named.flatMap((id) => {
      const wearable = Option.fromNullishOr(byPiece.get(PieceId.make(rows.get(id)?.pieceId ?? '')))
      return Option.toArray(Option.map(wearable, (found) => [id, found] as const))
    }),
  )
})

/** A seeded board as it stands, read as its owner. */
const statusOf = Effect.fnUntraced(function* (seedId: string, boardId: string, version: number) {
  const board = yield* (yield* Boards).getBoard(BoardId.make(boardId))
  const status: SeedBoardStatus = {
    seedId,
    boardId: board.id,
    version,
    visibility: board.visibility,
    check: board.check?.state ?? null,
  }
  return status
})

const seedBoard = Effect.fnUntraced(function* (seedId: string, request: SeedBoardRequest) {
  const accountId = yield* houseAccount(request.email)
  const digest = yield* digestsOf(request)
  const prior = yield* stored((yield* SeedStore).seededAs(accountId, seedId))
  if (Option.isSome(prior) && prior.value.digest === digest)
    return {
      ...(yield* statusOf(seedId, prior.value.boardId, prior.value.version).pipe(as(accountId))),
      outcome: 'unchanged' as const,
    }
  const plan = yield* planOf(seedId, request, yield* wearablesFor(accountId, request))
  const board = Option.isSome(prior)
    ? yield* updatedBoard(seedId, request, digest, prior.value, plan).pipe(as(accountId))
    : yield* createdBoard(seedId, request, digest, plan).pipe(as(accountId))
  const status = yield* statusOf(seedId, board.id, request.version).pipe(as(accountId))
  return { ...status, outcome: Option.isSome(prior) ? ('updated' as const) : ('created' as const) }
})

/** The house profile as the entry says, its Slovenian beside it, published and marked as the house's. */
const seedProfile = Effect.fnUntraced(function* (input: SeedProfile) {
  const accountId = yield* houseAccount(input.email)
  const profiles = yield* Profiles
  const { operationId: _operationId, email: _email, ...entry } = input
  const digest = yield* digestOf(JSON.stringify(entry))
  const op = (step: string): Effect.Effect<OperationId> => stepOf('profile', step, 1, digest)
  const before = yield* profiles.getProfile().pipe(as(accountId))
  const same = before.handle === input.handle && before.name === input.name && before.bio === input.bio
  if (!same)
    yield* profiles
      .updateProfile({ operationId: yield* op('profile'), handle: input.handle, name: input.name, bio: input.bio })
      .pipe(as(accountId))
  const db = yield* Database
  const translation = {
    accountId,
    locale: 'sl' as const,
    name: input.sl.name,
    bio: input.sl.bio,
    sourceDigest: yield* profileSourceDigest(input.name, input.bio),
    review: input.sl.review,
    updatedAt: yield* nowDate,
  }
  yield* stored(query(() => profileTranslationWrite(db, translation)))
  const after = before.published
    ? before
    : yield* profiles.publishProfile({ operationId: yield* op('publish'), published: true }).pipe(as(accountId))
  yield* (yield* Curation).markHouse(input.handle, true, Option.none())
  const now = yield* profiles.getProfile().pipe(as(accountId))
  return {
    accountId,
    outcome: same && after.published ? ('unchanged' as const) : ('updated' as const),
    check: now.check?.state ?? null,
  }
})

const removeSeededBoard = Effect.fnUntraced(function* (seedId: string, input: RemoveSeededBoard) {
  const accountId = yield* houseAccount(input.email)
  const prior = yield* stored((yield* SeedStore).seededAs(accountId, seedId))
  if (Option.isNone(prior)) return yield* NotFound.make({})
  yield* stored(forgetSteps(prior.value))
  yield* (yield* Boards).deleteBoard(BoardId.make(prior.value.boardId), input.operationId).pipe(as(accountId))
})

const seedPieces = Effect.fnUntraced(function* (email: string) {
  const accountId = yield* houseAccount(email)
  const rows = yield* garmentsOf(accountId)
  return {
    accountId,
    pieces: rows.map((row) => ({
      manifestId: row.manifestId,
      pieceId: PieceId.make(row.pieceId),
      status: row.status,
      cutOut: row.imageKey !== null && row.imageKey !== row.originalKey,
      type: row.type,
      origin: row.origin,
      describedType: row.describedType,
      describedWhole: row.describedWhole,
    })),
  }
})

type SeedServices = Boards | Profiles | Curation | Deployment | ImportStore | SeedStore | WardrobeStore | Database

const isNotFound = Schema.is(NotFound)
const isConflict = Schema.is(OperationConflict)
const isRefused = Schema.is(SeedRefused)
const isUnavailable = Schema.is(Unavailable)
const isStoreUnavailable = Schema.is(StoreUnavailable)

/** A failure as the seed's endpoints answer it: not found, a conflicting operation id, a refusal or unavailable as
 * they are; any other refusal of the board or profile services (a table saved meanwhile, a handle taken) is the
 * entry's, by its name. */
const answered = (error: unknown): NotFound | OperationConflict | SeedRefused | Unavailable => {
  if (isNotFound(error) || isConflict(error) || isRefused(error) || isUnavailable(error)) return error
  if (isStoreUnavailable(error)) return Unavailable.make({})
  return SeedRefused.make({ reason: 'badEntry', detail: [error instanceof Error ? error.name : 'refused'] })
}

const make = Effect.map(Effect.context<SeedServices>(), (context) => {
  /** Every step as the operator: nobody else reaches these. */
  const operator =
    <A extends ReadonlyArray<unknown>, B, E, R extends SeedServices>(step: (...args: A) => Effect.Effect<B, E, R>) =>
    (...args: A) =>
      Effect.flatMap(CurrentOperator, () => step(...args).pipe(Effect.mapError(answered), Effect.provide(context)))
  return {
    seedProfile: operator(seedProfile),
    seedBoard: operator(seedBoard),
    seededBoard: operator(
      Effect.fnUntraced(function* (seedId: string, email: string) {
        const accountId = yield* houseAccount(email)
        const prior = yield* stored((yield* SeedStore).seededAs(accountId, seedId))
        if (Option.isNone(prior)) return yield* NotFound.make({})
        return yield* statusOf(seedId, prior.value.boardId, prior.value.version).pipe(as(accountId))
      }),
    ),
    removeSeededBoard: operator(removeSeededBoard),
    seedPieces: operator(seedPieces),
  }
})

/** The house boards' seed, for the operator: every method needs the operator's token, which its routes' middleware
 * provides per request.
 * @effect-expect-leaking CurrentOperator */
export class Seeding extends Context.Service<Seeding, Effect.Success<typeof make>>()('@styld/server/seed/Seeding') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Seeding.of(service)),
  )
}
