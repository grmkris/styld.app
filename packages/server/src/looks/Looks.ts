import {
  type CreateLook,
  Look,
  type LookId,
  LookNotFound,
  OperationConflict,
  PieceNotFound,
  WardrobeUnavailable,
} from '@styld/protocol'
import { Context, DateTime, Effect, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { CurrentAccount } from '../CurrentAccount.ts'
import { toPiece } from '../wardrobe/Wardrobe.ts'
import type { StoreUnavailable } from '../wardrobe/Store.ts'
import { type LookRow, type LookStore, makeLookStore } from './Store.ts'

const unavailable = () => WardrobeUnavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)

/** Looks as the protocol shows them, each with the pieces still in the wardrobe. */
const shown = (store: LookStore, rows: ReadonlyArray<LookRow>) =>
  Effect.gen(function* () {
    const found = yield* stored(store.piecesOf(rows.map(({ id }) => id)))
    return yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const lookPieces = yield* Effect.forEach(
          found.filter(({ lookId }) => lookId === row.id),
          ({ piece }) => toPiece(piece),
        )
        // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
        return yield* Schema.decodeUnknownEffect(Look)({
          id: row.id,
          name: row.name,
          occasion: row.occasion,
          pieces: lookPieces,
          createdAt: row.createdAt.toISOString(),
        }).pipe(Effect.orDie)
      }),
    )
  })

const make = (database: Parameters<typeof makeLookStore>[0]) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const store = makeLookStore(database)
    const digest = (text: string) =>
      crypto
        .digest('SHA-256', new TextEncoder().encode(text))
        .pipe(Effect.map(Base64Url.encode), Effect.mapError(unavailable))
    const newId = crypto.randomBytes(16).pipe(
      Effect.map((bytes) => `lk_${Base64Url.encode(bytes)}`),
      Effect.mapError(unavailable),
    )
    const one = (accountId: string, lookId: string) =>
      Effect.gen(function* () {
        const row = yield* stored(store.findLook(accountId, lookId))
        if (Option.isNone(row)) return yield* LookNotFound.make({})
        const [look] = yield* shown(store, [row.value])
        return look ?? (yield* LookNotFound.make({}))
      })
    return {
      /** Put a look together from the account's own pieces. The same operation id answers the same
       * look; using it for another look is a conflict. */
      createLook: Effect.fn('Styld.Looks.create')(function* (input: CreateLook) {
        const { accountId } = yield* CurrentAccount
        const inputDigest = yield* digest(JSON.stringify([input.name, input.occasion ?? null, input.pieceIds]))
        const receipt = yield* stored(store.findReceipt(accountId, input.operationId))
        if (Option.isSome(receipt))
          return receipt.value.inputDigest === inputDigest && receipt.value.command === 'createLook'
            ? yield* one(accountId, receipt.value.result)
            : yield* OperationConflict.make({})
        const pieceIds = [...new Set(input.pieceIds)]
        const owned = yield* stored(store.ownPieces(accountId, pieceIds))
        if (pieceIds.some((id) => !owned.has(id))) return yield* PieceNotFound.make({})
        const id = yield* newId
        const at = DateTime.toDateUtc(yield* DateTime.now)
        yield* stored(
          store.createLook(
            { id, accountId, name: input.name, occasion: input.occasion ?? null, createdAt: at },
            pieceIds,
            {
              accountId,
              operationId: input.operationId,
              command: 'createLook',
              inputDigest,
              result: id,
              createdAt: at,
            },
          ),
        )
        return yield* one(accountId, id)
      }),
      listLooks: Effect.fn('Styld.Looks.list')(function* () {
        const { accountId } = yield* CurrentAccount
        return yield* shown(store, yield* stored(store.listLooks(accountId)))
      }),
      getLook: Effect.fn('Styld.Looks.get')(function* (lookId: LookId) {
        const { accountId } = yield* CurrentAccount
        return yield* one(accountId, lookId)
      }),
      deleteLook: Effect.fn('Styld.Looks.delete')(function* (lookId: LookId) {
        const { accountId } = yield* CurrentAccount
        if (!(yield* stored(store.deleteLook(accountId, lookId)))) return yield* LookNotFound.make({})
      }),
    }
  })

/** Looks, for the website and for assistants. Every operation acts for `CurrentAccount`, which HTTP and MCP
 * provide per request, so no operation takes whose looks they are from its input. */
export class Looks extends Context.Service<Looks, Effect.Success<ReturnType<typeof make>>>()('@styld/server/Looks') {}

/** Looks over the Worker's database. Build it once per isolate. */
export const makeLooks = (database: Parameters<typeof makeLookStore>[0]) =>
  Effect.map(make(database), (service) => Looks.of(service))
