import { Schema } from 'effect'
import { OperationId } from '../Identity.ts'
import { Credits } from './Credits.ts'
import { Day } from './Day.ts'

/** Credits held for an operation until it settles, the day they were taken from, and how many of them came from the
 * free credits (absent: none), so a refund returns each part where it came from. */
const Reservation = Schema.Struct({ day: Day, amount: Credits, fromFree: Schema.optionalKey(Credits) })
export const WalletState = Schema.Struct({
  /** The allowance left today: it resets, rather than accumulates, when the day changes. `allowance` is what the day
   * was granted (absent in state written before 4 November 2026, which granted `allowanceBeforePremium`). */
  daily: Schema.Struct({ day: Schema.NullOr(Day), remaining: Credits, allowance: Schema.optionalKey(Credits) }),
  /** The free credits left of the account's one-time grant (owner, 4 November 2026: 3, never reset). Absent until the
   * first reservation that brings the grant records it, so every Wallet written before then starts with all of it. */
  free: Schema.optionalKey(Credits),
  reservations: Schema.Record(OperationId, Reservation),
})
export type WalletState = typeof WalletState.Type
