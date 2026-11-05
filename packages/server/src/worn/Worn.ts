import {
  CurrentAccount,
  Day,
  NotFound,
  type OperationId,
  PieceId,
  type WearPieces,
  type WornDay,
  type WornRange,
} from '@styld/protocol'
import { Context, Effect, Layer } from 'effect'
import { CaptureMetrics } from '../kernel/Metrics.ts'
import { outfitKept } from '../outfits/Outfits.ts'
import { Database, stored } from '../kernel/Db.ts'
import { recorded } from '../kernel/Receipts.ts'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { wornStore } from './Store.ts'

type Range = typeof WornRange.Type

/** The most days one read spans, after its first. */
const longestRange = 62
const dayMillis = 24 * 60 * 60 * 1000

/** A calendar day as a count of days, to measure a range; months that are too short simply roll over. */
const dayNumber = (day: Day) =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / dayMillis

/** Whether a range reads forwards and spans at most `longestRange` days. */
const readable = ({ from, to }: Range) => {
  const span = dayNumber(to) - dayNumber(from)
  return span >= 0 && span <= longestRange
}

/** The rows of a range as days, in order, each with its pieces in order. */
const byDay = (rows: ReadonlyArray<{ readonly day: string; readonly pieceId: string }>) => {
  const days = new Map<string, Array<PieceId>>()
  for (const { day, pieceId } of rows) {
    const worn = days.get(day)
    if (worn === undefined) days.set(day, [PieceId.make(pieceId)])
    else worn.push(PieceId.make(pieceId))
  }
  return [...days].map(([day, pieceIds]): WornDay => ({ day: Day.make(day), pieceIds }))
}

const make = Effect.gen(function* () {
  const db = yield* Database
  const metrics = yield* CaptureMetrics
  const store = wornStore(db)
  return {
    /** The days worn in a range, both ends included. A range that runs backwards or spans more than
     * `longestRange` days reads as no days. */
    listWorn: Effect.fn('Styld.Worn.list')(function* (range: Range) {
      const { accountId } = yield* CurrentAccount
      if (!readable(range)) return []
      return byDay(yield* stored(store.wornBetween(accountId, range.from, range.to)))
    }),
    /** "Wear this": the day's outfit from the account's own pieces, replacing what was recorded before; counted for the
     * outfit engine when it proposed the outfit. */
    wearPieces: Effect.fn('Styld.Worn.wear')(function* (day: Day, input: WearPieces) {
      const { accountId } = yield* CurrentAccount
      const { operationId, ...wearing } = input
      const pieceIds = [...new Set(wearing.pieceIds)]
      const write = Effect.gen(function* () {
        const owned = yield* stored(ownPieceIds(db, accountId, pieceIds))
        if (pieceIds.some((id) => !owned.has(id))) return yield* NotFound.make({})
        if (wearing.proposal !== undefined) yield* outfitKept(metrics, wearing.proposal, 'worn')
        return { statements: store.wear(accountId, day, pieceIds), result: day }
      })
      const worn: WornDay = { day, pieceIds }
      return yield* recorded(
        db,
        { accountId, operationId, command: 'wearPieces', input: [day, wearing] },
        { write, answer: () => Effect.succeed(worn) },
      )
    }),
    clearWorn: Effect.fn('Styld.Worn.clear')(function* (day: Day, operationId: OperationId) {
      const { accountId } = yield* CurrentAccount
      yield* recorded(
        db,
        { accountId, operationId, command: 'clearWorn', input: day },
        {
          write: Effect.succeed({ statements: [store.clear(accountId, day)], result: day }),
          answer: () => Effect.void,
        },
      )
    }),
  }
})

/** What the person wore, for the website. Every operation acts for `CurrentAccount`, which HTTP provides per
 * request. */
export class Worn extends Context.Service<Worn, Effect.Success<typeof make>>()('@styld/server/worn/Worn') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Worn.of(service)),
  )
}
