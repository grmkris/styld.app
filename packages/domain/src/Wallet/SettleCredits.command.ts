import * as Domain from '@alchemy.run/domain'
import { Schema } from 'effect'
import { NotAuthorized } from '../CurrentActor.context.ts'
import { OperationId } from '../Identity.ts'
import { Session } from '../Session.middleware.ts'
import { Credits } from './Credits.ts'
import { WalletId } from './Wallet.id.ts'

export const Settlement = Schema.Literals(['consumed', 'refunded'])
// A settle without a pending hold is rejected, never accepted as a no-op: Domain keeps
// receipts only for accepted commands, so an early settle cannot claim the operation's
// settle ID and leave a hold that arrives later impossible to settle.
export class ReservationNotFound extends Domain.Rejection('ReservationNotFound') {}
export class CreditsSettled extends Domain.Event('CreditsSettled', {
  operationId: OperationId,
  outcome: Settlement,
  fromDaily: Credits,
  dailyAfter: Credits,
  fromSubscription: Credits,
  fromPurchased: Credits,
  subscriptionAfter: Credits,
  purchasedAfter: Credits,
}) {}
// Sent after a definitive request outcome. Unknown provider outcomes retain their hold.
export class SettleCredits extends Domain.Command('SettleCredits', {
  target: WalletId,
  middleware: [Session],
  input: { operationId: OperationId, outcome: Settlement },
  events: [CreditsSettled],
  rejects: [NotAuthorized, ReservationNotFound],
}) {}
