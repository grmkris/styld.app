import { Auth, Password, Sessions } from '@yielded/auth'
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

export const sessionOptions = Sessions.stateful({
  cacheFor: 30_000,
})

export const makeAuth = () =>
  Auth.make('styld/Auth', {
    claims: AccountClaims,
    sessions: sessionOptions,
    strategies: { password: Password.make() },
    defaultStrategy: 'password',
  })
