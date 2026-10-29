import { Schema } from 'effect'

/** A UTC calendar day, `2026-10-29`. The free allowance resets when it changes. */
export const Day = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/))
