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

/** A change the server refused before running it: it did not come from the website itself (wrong
 * Origin or missing CSRF header). */
export class RequestRefused extends Schema.TaggedError<RequestRefused>()(
  'RequestRefused',
  {},
  { httpApiStatus: 403 },
) {}
