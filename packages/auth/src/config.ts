import { Auth, AuthContract, Password, SessionContract, Sessions } from '@yielded/auth'
import { Schema } from 'effect'

export const AccountClaims = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
})
export type AccountClaims = typeof AccountClaims.Type

export const requirement = Sessions.AuthenticationRequirement.make({
  alternatives: [{ factors: ['knowledge'], userVerified: false, phishingResistant: false, minimumCredentials: 1 }],
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
  }),
})

/** The signed-in session for HttpApi endpoints: they declare `SessionHttp.RequireSession` and read
 * `SessionHttp.CurrentSession`; the API Worker implements it with Yielded's session check. The name
 * is the host-only secure cookie the API Worker sets in every environment. */
export const SessionHttp = SessionContract.makeSessionHttpContract('styld/Session', AuthApi.sessions.Session, {
  cookieName: '__Host-effect-auth-session',
})

export const makeAuth = () =>
  Auth.make(AuthApi, {
    sessions: sessionOptions,
    strategies: { password: Password.make() },
    defaultStrategy: 'password',
  })
