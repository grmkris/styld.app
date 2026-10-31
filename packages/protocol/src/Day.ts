import { Schema } from 'effect'

/** A calendar day in the person's own time zone, as the website reads it: `2026-10-30`. */
export const Day = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)).pipe(
  Schema.brand('Day'),
)
export type Day = typeof Day.Type
