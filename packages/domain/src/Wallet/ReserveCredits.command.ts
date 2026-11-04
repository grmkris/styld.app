import * as Domain from '@alchemy.run/domain'
import { Schema } from 'effect'
import { OperationId } from '../Identity.ts'
import { Credits } from './Credits.ts'
import { Day } from './Day.ts'
import { WalletId } from './Wallet.id.ts'

export class InsufficientCredits extends Domain.Rejection('InsufficientCredits', {
  available: Credits,
  required: Credits,
}) {}
export class ReservationConflict extends Domain.Rejection('ReservationConflict') {}
export class TooManyReservations extends Domain.Rejection('TooManyReservations') {}
export class CreditsReserved extends Domain.Event('CreditsReserved', {
  operationId: OperationId,
  day: Day,
  amount: Credits,
  dailyAfter: Credits,
  /** The allowance `day` was granted once this reservation was taken; absent in events written before 4 November
   * 2026, which granted `allowanceBeforePremium`. */
  dailyAllowance: Schema.optionalKey(Credits),
  /** How many of `amount` came from the free credits, and the free credits left after; both absent when the
   * reservation brought no grant and none was recorded (every event before 4 November 2026 evening). */
  fromFree: Schema.optionalKey(Credits),
  freeAfter: Schema.optionalKey(Credits),
}) {}
export class ReserveCredits extends Domain.Command('ReserveCredits', {
  target: WalletId,
  // `day` (UTC, from the server's clock) and that day's `dailyAllowance` (free or premium, from D1) come with
  // the command, so `decide` stays pure. Neither is part of the reservation's identity: a retry across midnight
  // is the same reservation. A larger allowance than the day was granted tops the day up by the difference.
  // `freeCredits` is the account's one-time grant (owner, 4 November 2026: 3 credits a new account has once, never
  // reset), recorded by the first reservation that brings it; the day's allowance is spent first, then the free
  // credits.
  input: {
    operationId: OperationId,
    amount: Credits,
    day: Day,
    dailyAllowance: Credits,
    freeCredits: Schema.optionalKey(Credits),
  },
  events: [CreditsReserved],
  rejects: [InsufficientCredits, ReservationConflict, TooManyReservations],
}) {}
