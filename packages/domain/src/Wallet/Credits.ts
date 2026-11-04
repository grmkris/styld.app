import { Schema } from 'effect'
const maximumCredits = 1_000_000_000
export const Credits = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maximumCredits }))
export const maximumPendingReservations = 256

/** The allowance every day had before a day's allowance was recorded (4 November 2026): an event or a snapshot without
 * one was written under the free 100 a day, so a later, larger allowance that day tops it up from there. */
export const allowanceBeforePremium = 100
