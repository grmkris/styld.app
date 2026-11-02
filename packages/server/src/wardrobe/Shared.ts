import type { PaidAttempts } from '../usage/Attempts.ts'
import type { Holds } from '../usage/Holds.ts'
import {
  CurrentAccount,
  NotFound,
  Piece,
  type PiecePicture,
  type PieceTurn,
  PieceType,
  Unavailable,
  UploadRefused,
} from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type { PieceChanged } from '../safety/PieceChanged.ts'
import type { GarmentCutout, PieceQueue } from './Processing.ts'
import { pictureView, turnView } from './Shown.ts'
import { type PieceRow, type UploadRow, WardrobeStore } from './Store.ts'
import { nowDate, type StoreUnavailable } from '../kernel/Db.ts'
import { deleteAfterRows, Media } from '../kernel/Media.ts'

// What every part of the wardrobe service shares: the services it acts through, the piece as its owner reads it, the
// ownership checks of pieces and uploads, and how a store's failure reads to callers. Every operation yields the
// services it uses; the `Wardrobe` layer provides them once (`Wardrobe.ts`).

/** The services the wardrobe's operations act through, provided once by the `Wardrobe` layer. */
export type WardrobeServices = WardrobeStore | Media | PieceQueue | GarmentCutout | PieceChanged | Holds | PaidAttempts

export const unavailable = () => Unavailable.make({})
export const refused = (reason: UploadRefused['reason']) => UploadRefused.make({ reason })
export const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) => Effect.mapError(effect, unavailable)

/** A stored piece as the protocol shows it, with its clean picture and its turn when they were asked for. */
export const toPiece = (row: PieceRow, picture?: PiecePicture, turn?: PieceTurn) =>
  Schema.decodeUnknownEffect(Piece)({
    id: row.id,
    name: row.name,
    notes: row.notes,
    type: row.type,
    colours: row.colours,
    season: row.season,
    occasions: row.occasions,
    pattern: row.pattern,
    brand: row.brand,
    shopUrl: row.shopUrl,
    hasBack: row.backImageKey !== null,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(picture === undefined ? {} : { picture }),
    ...(turn === undefined ? {} : { turn }),
    // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
  }).pipe(Effect.orDie)

/** A stored piece's type, read alone: work that needs only the type, such as its cut-out, never depends on the rest of
 * the row. Only the service writes the column, through the same schema; one that does not decode is a bug. */
export const typeOf = (row: Pick<PieceRow, 'type'>) =>
  Schema.decodeUnknownEffect(PieceType)(row.type).pipe(Effect.orDie)

/** The account's own piece, or `NotFound`, as if another account's did not exist: the one ownership check for a
 * piece, which My Gallery reuses. */
export const accountPiece = Effect.fnUntraced(function* (accountId: string, pieceId: string) {
  const row = yield* stored((yield* WardrobeStore).findPiece(accountId, pieceId))
  return yield* Option.match(row, { onNone: () => Effect.fail(NotFound.make({})), onSome: Effect.succeed })
})

/** The current account's own piece (`accountPiece`). */
export const ownPiece = Effect.fnUntraced(function* (pieceId: string) {
  const { accountId } = yield* CurrentAccount
  return yield* accountPiece(accountId, pieceId)
})

/** The piece's clean picture row, if a drawing was ever asked for. */
export const pictureRow = (accountId: string, pieceId: string) =>
  Effect.map(
    stored(Effect.flatMap(WardrobeStore, (store) => store.pictureOf(accountId, pieceId))),
    Option.getOrUndefined,
  )

/** A piece as its owner sees it, with its clean picture and its turn. */
export const ownerPiece = (accountId: string, row: PieceRow) =>
  Effect.gen(function* () {
    const picture = yield* pictureRow(accountId, row.id)
    const turn = Option.getOrUndefined(yield* stored((yield* WardrobeStore).turnOf(accountId, row.id)))
    const at = yield* nowDate
    return yield* toPiece(
      row,
      picture === undefined ? undefined : pictureView(picture, at),
      turn === undefined ? undefined : turnView(turn, at),
    )
  })

/** Why an upload cannot make something, if it cannot. */
const useRefusal = (upload: Option.Option<UploadRow>): Option.Option<UploadRefused['reason']> =>
  Option.match(upload, {
    onNone: () => Option.some('notFound'),
    onSome: ({ status }) =>
      status === 'pending'
        ? Option.some('notReceived')
        : status === 'used'
          ? Option.some('alreadyUsed')
          : Option.none(),
  })

/** A received upload of the account that has not made anything yet: what a piece, a capture, an outfit photo or a
 * board's picture is made from. Another account's upload reads as not found. */
export const usableUpload = Effect.fnUntraced(function* (accountId: string, uploadId: string) {
  const found = yield* stored((yield* WardrobeStore).findUpload(uploadId))
  const upload = Option.filter(found, (row) => row.accountId === accountId)
  const refusal = useRefusal(upload)
  if (Option.isSome(refusal) || Option.isNone(upload))
    return yield* refused(Option.getOrElse(refusal, () => 'notFound'))
  return upload.value
})

/** Delete the objects of rows already deleted (or changed) that nothing else shows any more (`keysInUse`): the one
 * order objects go in, rows first. A failed delete is logged, its bytes left under the account's prefix. */
export const forgetObjects = (accountId: string, keys: ReadonlyArray<string>, owner: string) =>
  Effect.gen(function* () {
    const inUse = yield* stored((yield* WardrobeStore).keysInUse(accountId, keys))
    yield* deleteAfterRows(
      (yield* Media).bucket,
      [...new Set(keys)].filter((key) => !inUse.has(key)),
      owner,
    )
  })
