import * as Domain from '@alchemy.run/domain'
import { Schema } from 'effect'
import { OperationId } from '../Identity.ts'
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
  amount: Credits,
  dailyAfter: Credits,
}) {}
// Sent once the work ended: consumed when it succeeded, refunded when it failed or its outcome is unknown.
export class SettleCredits extends Domain.Command('SettleCredits', {
  target: WalletId,
  input: { operationId: OperationId, outcome: Settlement },
  events: [CreditsSettled],
  rejects: [ReservationNotFound],
}) {}
