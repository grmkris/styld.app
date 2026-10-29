import { operationReceipts } from '@styld/db'
import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'

/** The receipt of an operation an account already ran: what it asked (as a digest) and what it made.
 * Every idempotent write (adding a piece, a capture, a review, a look) answers a repeat from it. */
export const receiptQuery = (db: ReturnType<typeof drizzle>, accountId: string, operationId: string) =>
  db
    .select()
    .from(operationReceipts)
    .where(and(eq(operationReceipts.accountId, accountId), eq(operationReceipts.operationId, operationId)))
    .limit(1)
