import * as Domain from '@alchemy.run/domain'
import { NotAuthorized } from '../CurrentActor.context.ts'
import { Fingerprint, OperationId } from '../Identity.ts'
import { Session } from '../Session.middleware.ts'
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
  fingerprint: Fingerprint,
  day: Day,
  fromDaily: Credits,
  dailyAfter: Credits,
  fromSubscription: Credits,
  fromPurchased: Credits,
  subscriptionAfter: Credits,
  purchasedAfter: Credits,
}) {}
export class ReserveCredits extends Domain.Command('ReserveCredits', {
  target: WalletId,
  middleware: [Session],
  // `day` (UTC, from the server's clock) and that day's free `dailyAllowance` come with the command, so
  // `decide` stays pure. Neither is part of the reservation's identity: a retry across midnight is the
  // same reservation.
  input: { operationId: OperationId, fingerprint: Fingerprint, amount: Credits, day: Day, dailyAllowance: Credits },
  events: [CreditsReserved],
  rejects: [NotAuthorized, InsufficientCredits, ReservationConflict, TooManyReservations],
}) {}
