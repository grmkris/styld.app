import {
  Piece,
  PieceNotFound,
  type PiecePicture,
  type PieceTurn,
  PieceType,
  UploadRefused,
  WardrobeUnavailable,
} from '@styld/protocol'
import { DateTime, Effect, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { PieceChanged } from '../safety/PieceChanged.ts'
import type { ImageBindings } from './Delivery.ts'
import type { GarmentCutout, WorkMessage } from './Processing.ts'
import { pictureView, turnView } from './Shown.ts'
import type { makeStore, PieceRow, Store, StoreUnavailable, UploadRow } from './Store.ts'

// What every part of the wardrobe service shares: its bindings and stores, the piece as its owner reads it, and how
// a store's failure reads to callers.

/** The Cloudflare bindings the wardrobe stores into, as Alchemy's runtime objects. */
export interface WardrobeBindings extends ImageBindings {
  readonly database: Parameters<typeof makeStore>[0]
  readonly queue: { send(message: WorkMessage): Promise<unknown> }
}

export const unavailable = () => WardrobeUnavailable.make({})
export const refused = (reason: UploadRefused['reason']) => UploadRefused.make({ reason })
export const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) => Effect.mapError(effect, unavailable)
export const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

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

export interface Parts {
  readonly bindings: WardrobeBindings
  readonly store: Store
  readonly cutout: GarmentCutout['Service']
  readonly pieceChanged: PieceChanged['Service']
  readonly randomToken: (bytes: number) => Effect.Effect<string, WardrobeUnavailable>
  readonly digest: (text: string) => Effect.Effect<string, WardrobeUnavailable>
}

export const ownPiece = (parts: Parts) =>
  Effect.fnUntraced(function* (pieceId: string) {
    const { accountId } = yield* CurrentAccount
    const row = yield* stored(parts.store.findPiece(accountId, pieceId))
    return yield* Option.match(row, { onNone: () => Effect.fail(PieceNotFound.make({})), onSome: Effect.succeed })
  })

/** The piece's clean picture row, if a drawing was ever asked for. */
export const pictureRow = (parts: Parts, accountId: string, pieceId: string) =>
  Effect.map(stored(parts.store.pictureOf(accountId, pieceId)), Option.getOrUndefined)

/** A piece as its owner sees it, with its clean picture and its turn. */
export const ownerPiece = (parts: Parts, accountId: string, row: PieceRow) =>
  Effect.gen(function* () {
    const picture = yield* pictureRow(parts, accountId, row.id)
    const turn = Option.getOrUndefined(yield* stored(parts.store.turnOf(accountId, row.id)))
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

/** A received upload of the account that has not made anything yet: what a piece or a board's picture is
 * made from. Another account's upload reads as not found. */
export const usableUpload = Effect.fnUntraced(function* (store: Store, accountId: string, uploadId: string) {
  const upload = Option.filter(yield* stored(store.findUpload(uploadId)), (row) => row.accountId === accountId)
  const refusal = useRefusal(upload)
  if (Option.isSome(refusal) || Option.isNone(upload))
    return yield* refused(Option.getOrElse(refusal, () => 'notFound'))
  return upload.value
})
