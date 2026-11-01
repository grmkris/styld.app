import { Day, PieceId, NotFound, type WearPieces, Unavailable, type WornDay, type WornRange } from '@styld/protocol'
import { Context, Effect, Layer } from 'effect'
import { CaptureMetrics } from '../capture/Metrics.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { outfitKept } from '../outfits/Outfits.ts'
import { Database, type StoreUnavailable } from '../kernel/Db.ts'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { wornStore } from './Store.ts'

type Range = typeof WornRange.Type

const unavailable = () => Unavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)

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
      const pieceIds = [...new Set(input.pieceIds)]
      const owned = yield* stored(ownPieceIds(db, accountId, pieceIds))
      if (pieceIds.some((id) => !owned.has(id))) return yield* NotFound.make({})
      yield* stored(store.wear(accountId, day, pieceIds))
      if (input.proposal !== undefined) yield* outfitKept(metrics, input.proposal, 'worn')
      const worn: WornDay = { day, pieceIds }
      return worn
    }),
    clearWorn: Effect.fn('Styld.Worn.clear')(function* (day: Day) {
      const { accountId } = yield* CurrentAccount
      yield* stored(store.clear(accountId, day))
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
