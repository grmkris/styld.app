import * as Domain from '@alchemy.run/domain'
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
}) {}
export class ReserveCredits extends Domain.Command('ReserveCredits', {
  target: WalletId,
  // `day` (UTC, from the server's clock) and that day's free `dailyAllowance` come with the command, so
  // `decide` stays pure. Neither is part of the reservation's identity: a retry across midnight is the
  // same reservation.
  input: { operationId: OperationId, amount: Credits, day: Day, dailyAllowance: Credits },
  events: [CreditsReserved],
  rejects: [InsufficientCredits, ReservationConflict, TooManyReservations],
}) {}
