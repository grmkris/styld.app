import { Schema } from 'effect'

/** The signed-in person as the website and assistants see them. */
export const Me = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  email: Schema.String,
})
export type Me = typeof Me.Type

/** The account could not be changed just now; the request may be retried. */
export class AccountUnavailable extends Schema.TaggedError<AccountUnavailable>()(
  'AccountUnavailable',
  {},
  { httpApiStatus: 503 },
) {}
