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
}) {}
export class ReserveCredits extends Domain.Command('ReserveCredits', {
  target: WalletId,
  // `day` (UTC, from the server's clock) and that day's `dailyAllowance` (free or premium, from D1) come with
  // the command, so `decide` stays pure. Neither is part of the reservation's identity: a retry across midnight
  // is the same reservation. A larger allowance than the day was granted tops the day up by the difference.
  input: { operationId: OperationId, amount: Credits, day: Day, dailyAllowance: Credits },
  events: [CreditsReserved],
  rejects: [InsufficientCredits, ReservationConflict, TooManyReservations],
}) {}
