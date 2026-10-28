import type { GrantMonthlyCredits } from './GrantMonthlyCredits.command.ts'
import type { GrantPurchasedCredits } from './GrantPurchasedCredits.command.ts'
import type { ReserveCredits } from './ReserveCredits.command.ts'
import type { SettleCredits } from './SettleCredits.command.ts'

/**
 * Transport command IDs for every Wallet command. Domain skips `decide` for a
 * command ID it has already accepted, and the Wallet keeps only pending holds,
 * so these receipts are what stop a settled operation from being reserved
 * again and a payment from being granted twice. Derive IDs only here, from the
 * business identity; never send a random or caller-chosen ID.
 *
 * Inputs the Wallet checks for conflicts (reservation fingerprint and amount,
 * the monthly grant) are part of the ID, so a changed payload still reaches
 * `decide` and is rejected instead of being answered from an old receipt.
 */
export const reserveCommandId = (command: ReserveCredits): string =>
  `wallet/reserve/${command.operationId}/${command.fingerprint}/${command.amount}`

/** One settlement per operation, whichever outcome arrives first. */
export const settleCommandId = (command: SettleCredits): string => `wallet/settle/${command.operationId}`

export const purchaseCommandId = (command: GrantPurchasedCredits): string => `wallet/purchase/${command.paymentId}`

export const monthlyGrantCommandId = (command: GrantMonthlyCredits): string =>
  `wallet/monthly/${command.period}/${command.monthly}`
