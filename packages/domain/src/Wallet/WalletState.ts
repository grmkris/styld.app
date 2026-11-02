import { Schema } from 'effect'
import { OperationId } from '../Identity.ts'
import { Credits } from './Credits.ts'
import { Day } from './Day.ts'

/** Credits held for an operation until it settles, and the day they were taken from. */
const Reservation = Schema.Struct({ day: Day, amount: Credits })
export const WalletState = Schema.Struct({
  /** The free allowance left today: it resets, rather than accumulates, when the day changes. */
  daily: Schema.Struct({ day: Schema.NullOr(Day), remaining: Credits }),
  reservations: Schema.Record(OperationId, Reservation),
})
export type WalletState = typeof WalletState.Type
