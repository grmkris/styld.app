import {
  Day,
  PieceId,
  PieceNotFound,
  type WearPieces,
  WardrobeUnavailable,
  type WornDay,
  type WornRange,
} from '@styld/protocol'
import { Context, Effect } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { StoreUnavailable } from '../wardrobe/Store.ts'
import { makeWornStore } from './Store.ts'

type Range = typeof WornRange.Type

const unavailable = () => WardrobeUnavailable.make({})
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

const make = (database: Parameters<typeof makeWornStore>[0]) => {
  const store = makeWornStore(database)
  return {
    /** The days worn in a range, both ends included. A range that runs backwards or spans more than
     * `longestRange` days reads as no days. */
    listWorn: Effect.fn('Styld.Worn.list')(function* (range: Range) {
      const { accountId } = yield* CurrentAccount
      if (!readable(range)) return []
      return byDay(yield* stored(store.wornBetween(accountId, range.from, range.to)))
    }),
    /** "Wear this": the day's outfit from the account's own pieces, replacing what was recorded before. */
    wearPieces: Effect.fn('Styld.Worn.wear')(function* (day: Day, input: WearPieces) {
      const { accountId } = yield* CurrentAccount
      const pieceIds = [...new Set(input.pieceIds)]
      const owned = yield* stored(store.ownPieces(accountId, pieceIds))
      if (pieceIds.some((id) => !owned.has(id))) return yield* PieceNotFound.make({})
      yield* stored(store.wear(accountId, day, pieceIds))
      const worn: WornDay = { day, pieceIds }
      return worn
    }),
    clearWorn: Effect.fn('Styld.Worn.clear')(function* (day: Day) {
      const { accountId } = yield* CurrentAccount
      yield* stored(store.clear(accountId, day))
    }),
  }
}

/** What the person wore, for the website. Every operation acts for `CurrentAccount`, which HTTP provides per
 * request. */
export class Worn extends Context.Service<Worn, ReturnType<typeof make>>()('@styld/server/Worn') {}

/** Worn days over the Worker's database. Build it once per isolate. */
export const makeWorn = (database: Parameters<typeof makeWornStore>[0]) => Worn.of(make(database))
