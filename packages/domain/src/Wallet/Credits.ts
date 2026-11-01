import { Schema } from 'effect'
export const maximumCredits = 1_000_000_000
export const Credits = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maximumCredits }))
export const maximumPendingReservations = 256
