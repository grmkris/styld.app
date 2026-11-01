import type { ReserveCredits } from './ReserveCredits.command.ts'
import type { SettleCredits } from './SettleCredits.command.ts'

/**
 * Transport command IDs for every Wallet command. Domain skips `decide` for a
 * command ID it has already accepted, and the Wallet keeps only pending holds,
 * so these receipts are what stop a settled operation from being reserved
 * again. Derive IDs only here, from the business identity; never send a random
 * or caller-chosen ID.
 *
 * The amount is part of the reservation's ID, so a changed amount reaches
 * `decide` and is rejected while its hold is pending. After settlement the
 * Wallet keeps no record of the operation, so a hold ID is never reused for
 * other work: the server names one per attempt (`usage/Holds.ts`).
 */
export const reserveCommandId = (command: ReserveCredits): string =>
  `wallet/reserve/${command.operationId}/${command.amount}`

/** One settlement per operation, whichever outcome arrives first. */
export const settleCommandId = (command: SettleCredits): string => `wallet/settle/${command.operationId}`
