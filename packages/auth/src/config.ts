import { AuthContract, SessionContract, Sessions } from '@yielded/auth'
import { Schema } from 'effect'

import { emailEntryActions } from './EmailEntryContract.ts'

export const AccountClaims = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
})
export type AccountClaims = typeof AccountClaims.Type

/** A password (knowledge), or a fresh email code or Google sign-in (possession). Without the possession alternative an
 * email-code proof does not satisfy the subject requirement and completion falls into pending
 * authentication, which this installation does not configure (Y/sessions/module.ts:1306-1324). */
export const requirement = Sessions.AuthenticationRequirement.make({
  alternatives: [
    { factors: ['knowledge'], userVerified: false, phishingResistant: false, minimumCredentials: 1 },
    { factors: ['possession'], userVerified: false, phishingResistant: false, minimumCredentials: 1 },
  ],
  maximumAgeMillis: 300_000,
})

// Revocation, account disablement and securityRevision changes must be visible on the next request.
export const sessionOptions = Sessions.stateful()

/** Shared browser/server contract. Add an action only when its payload and
 * success/error semantics are ready for every transport. */
export const AuthApi = AuthContract.make('styld/Auth', {
  claims: AccountClaims,
  basePath: '/api/auth',
  actions: (sessions) => ({
    signIn: AuthContract.passwordSignIn(sessions),
    ...emailEntryActions(sessions),
    // Sign in with Google: the browser asks for Google's address, then Google returns to the callback
    // (`/api/auth/callback/google`, AuthHttp.ts), which completes it and sets the session cookie.
    googleSignIn: AuthContract.oauthSignIn({ strategy: 'google' }),
    googleComplete: AuthContract.oauthCompleteSignIn(sessions, { strategy: 'google' }),
  }),
})

/** The header every change from the website carries, so a cross-site form cannot make one: Yielded's auth routes and
 * the API's session middleware (`@styld/protocol` `SessionAccount`) both check it. */
export const csrf = { header: 'x-effect-auth-csrf', value: '1' } as const

/** The signed-in session for HttpApi endpoints: they declare `SessionHttp.RequireSession` and read
 * `SessionHttp.CurrentSession`; the API Worker implements it with Yielded's session check. The name
 * is the host-only secure cookie the API Worker sets in every environment. */
export const SessionHttp = SessionContract.makeSessionHttpContract('styld/Session', AuthApi.sessions.Session, {
  cookieName: '__Host-effect-auth-session',
})
