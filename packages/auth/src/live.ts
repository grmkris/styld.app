import * as D1Client from '@effect/sql-d1/D1Client'
import { Auth, Email, OAuth, Operations, Password, Proofs, Schema as AuthSchema } from '@yielded/auth'
import { hooksLayer } from '@yielded/auth/Persistence'
import * as WorkerdServices from '@yielded/auth-platform-workerd'
import { databaseLayer } from '@yielded/auth-persistence-drizzle/D1'
import * as Drizzle from 'drizzle-orm/effect-d1'
import { DateTime, Effect, Layer, Option, Redacted, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import { eq } from 'drizzle-orm'
import { drizzle as d1 } from 'drizzle-orm/d1'
import { accounts } from '@styld/db'

import { emailEntryBudgetLayer, passwordAttemptLimiter, type D1Source } from './AttemptLimiter.ts'
import { AccountClaims, requirement } from './config.ts'
import {
  emailDeliveryLayer,
  emailRendererLayer,
  proofDispatchSchedulerLayer,
  type CloudflareEmailSender,
} from './EmailDelivery.ts'
import { emailPersistenceLayer } from './EmailPersistence.ts'
import { emailOfAccount } from './Provisioning.ts'
import { AppAuth, Persistence, storage } from './storage.ts'

export type { D1Source } from './AttemptLimiter.ts'

/** Worker-supplied email entry configuration. Keyrings are dedicated: never the session keys. */
export interface EmailEntryOptions {
  readonly sender: CloudflareEmailSender
  /** `Styld <noreply@styld.app>` */
  readonly from: string
  /** HMAC keys for six-digit codes (Y/proofs/crypto.ts:44-52); keep retired ids >= 5 minutes. */
  readonly proofKeys: Proofs.ProofKeyring
  /** Signs the private `request-binding` cookie that ties a code to one browser flow. */
  readonly requestBindingKeys: Operations.RequestBindingConfiguration['keyring']
  /** Exact paths a completed entry may return to (Email.EmailReturnTargets.exactRoutes). */
  readonly returnTargets: ReadonlyArray<string>
}

/** Worker-supplied Google sign-in configuration. */
export interface GoogleEntryOptions {
  /** Encrypts each Google sign-in in progress; a dedicated keyring, never the session keys. Without it (local and
   * test runs) Google is not offered and a key made for this isolate stands in, unused. */
  readonly transactionKeys: Option.Option<OAuth.OAuthTransactionKeyring>
  /** Exact paths a Google sign-in may return to (OAuth.OAuthReturnTargets.exactRoutes). */
  readonly returnTargets: ReadonlyArray<string>
}

/** No account has this id: account ids are 32 random bytes, 43 characters (EmailPersistence.ts). */
const setupProbe = AuthSchema.SubjectId.make('styld-session-setup')

/** The enabled account behind a verified credential, or none. Shared by both sign-in methods. */
const accountClaims = Effect.gen(function* () {
  const drizzle = yield* Drizzle.makeWithDefaults({})
  return Effect.fn('Styld.Auth.claims')(function* (input: {
    readonly subjectId: string
    readonly email: string
    readonly emailVerified: boolean
  }) {
    const rows = yield* drizzle.select().from(accounts).where(eq(accounts.id, input.subjectId))
    // A missing or disabled account fails with NoSuchElementError; each resolver maps it.
    const account = yield* Effect.fromNullishOr(rows.find((row) => row.enabled))
    return yield* Schema.decodeUnknownEffect(AccountClaims)({
      accountId: account.id,
      displayName: account.displayName,
      email: input.email,
      emailVerified: input.emailVerified,
    })
  })
})

/** A keyring for an isolate where Google is not offered: nothing is ever sealed with it. */
const isolateKeyring = Effect.sync((): OAuth.OAuthTransactionKeyring => ({
  activeKeyId: 'isolate',
  keys: [
    {
      id: 'isolate',
      material: Redacted.make(Base64Url.encode(globalThis.crypto.getRandomValues(new Uint8Array(32)))),
    },
  ],
}))

/** The request-binding cookie ties a code, or a Google sign-in, to one browser flow; the HTTP adapter's Google
 * callback reads it too, so the routes are given it with the platform's crypto (`shared`). */
const sharedLayer = (email: EmailEntryOptions) =>
  Layer.mergeAll(
    Auth.RequestBindingConfig.layer({
      lifetimeMillis: 1_800_000,
      generation: 1,
      keyring: email.requestBindingKeys,
    }),
    WorkerdServices.layer,
  )

/** Google's claims and the services its sign-in needs (GoogleEntry.ts is the provider). */
const googleLayers = <R>(raw: D1Source<R>, google: GoogleEntryOptions) => {
  const auth = AppAuth
  // A Google credential exists only once its identity is attached to an account by the address Google verified
  // (GoogleEntry.ts). The claims carry the account's own verified address, never Google's current one: admin and house
  // checks read it.
  const googleClaims = Layer.effect(
    auth.strategies.google.SessionClaims,
    Effect.gen(function* () {
      const read = yield* accountClaims
      const db = d1(yield* raw)
      return {
        resolve: ({ subjectId }) =>
          Effect.tryPromise(() => emailOfAccount(db, subjectId)).pipe(
            Effect.flatMap((rows) => Effect.fromNullishOr(rows[0]?.email)),
            Effect.flatMap((address) => read({ subjectId, email: address, emailVerified: true })),
            Effect.mapError(() => OAuth.OAuthUnavailable.make({})),
          ),
      }
    }),
  )

  const googleEntry = Layer.mergeAll(
    Layer.unwrap(
      Effect.map(
        Option.match(google.transactionKeys, { onNone: () => isolateKeyring, onSome: Effect.succeed }),
        OAuth.OAuthTransactionProtector.layer,
      ),
    ),
    OAuth.OAuthReturnTargets.exactRoutes(google.returnTargets),
  )

  return { googleClaims, googleEntry }
}

export const makeAuthRuntime = <R>(
  raw: D1Source<R>,
  secret: Redacted.Redacted,
  email: EmailEntryOptions,
  google: GoogleEntryOptions,
) => {
  const auth = AppAuth
  // @effect-diagnostics-next-line unstableApiUsage:off -- The pinned Effect D1 adapter is the Worker persistence boundary.
  const sql = Layer.unwrap(Effect.map(raw, (db) => D1Client.layer({ db })))
  const database = databaseLayer.pipe(Layer.provide(sql))

  const passwordClaims = Layer.effect(
    auth.strategies.password.SessionClaims,
    Effect.map(accountClaims, (read) => ({
      resolve: ({ subjectId, credential }) =>
        read({
          subjectId,
          email: credential.identifier.value,
          emailVerified: credential.identifierVerifiedAtMillis !== undefined,
        }).pipe(Effect.mapError(() => Password.PasswordUnavailable.make({}))),
    })),
  ).pipe(Layer.provide(sql))

  // An email credential only exists for a verified address (P/internal/email-native-state.ts:154-160).
  const emailClaims = Layer.effect(
    auth.strategies.email.SessionClaims,
    Effect.map(accountClaims, (read) => ({
      resolve: ({ subjectId, credential }) =>
        read({ subjectId, email: credential.identifier.value, emailVerified: true }).pipe(
          Effect.mapError(() => Email.EmailUnavailable.make({})),
        ),
    })),
  ).pipe(Layer.provide(sql))

  const { googleClaims: unprovidedClaims, googleEntry } = googleLayers(raw, google)
  const googleClaims = unprovidedClaims.pipe(Layer.provide(sql))

  const persistence = Persistence.layer.pipe(
    Layer.provide(Persistence.Config.layer(storage)),
    Layer.provide(database),
    Layer.provide(sql),
  )

  // Yielded sets session storage up on first use, reading D1's catalog, behind a cache the whole isolate
  // shares (P/internal/persistence.ts:555-581). A request that finds that setup in flight waits on another
  // request's D1 reads, which workerd cancels as hung; a setup whose request went away hangs every later
  // session check in the isolate. Listing a subject that never exists sets it up while the application is
  // built, so the isolate keeps an application only once its sessions are ready, and a failed setup fails
  // that build instead of staying cached.
  const sessionsReady = Layer.effectDiscard(
    Effect.gen(function* () {
      const sessions = yield* auth.sessions.SessionRepository
      yield* sessions.list({ subjectId: setupProbe, limit: 1, now: yield* DateTime.now })
    }),
  ).pipe(Layer.provide(persistence))

  // EmailSignInTargets, ProofPersistence and the email RegistrationAuthority (EmailPersistence.ts).
  const emailPersistence = emailPersistenceLayer.pipe(
    Layer.provide(hooksLayer),
    Layer.provide(database),
    Layer.provide(sql),
  )

  const shared = sharedLayer(email)

  const emailEntry = Layer.mergeAll(
    emailDeliveryLayer(email.sender, email.from),
    emailRendererLayer,
    proofDispatchSchedulerLayer,
    Proofs.ProofKeys.layer(email.proofKeys),
    Email.EmailReturnTargets.exactRoutes(email.returnTargets),
  )

  /** Supply auth's services to a layer built over `auth` (Yielded's bare layer, or the HTTP adapter's, which adds the
   * OAuth providers). */
  const provide = <A, E, RIn>(layer: Layer.Layer<A, E, RIn>) =>
    layer.pipe(
      Layer.provide(passwordClaims),
      Layer.provide(emailClaims),
      Layer.provide(googleClaims),
      Layer.provide(googleEntry),
      Layer.provide(passwordAttemptLimiter(raw, secret)),
      Layer.provide(emailEntryBudgetLayer(raw, secret)),
      // Closest provider wins: keep the explicit ProofPersistence ahead of `persistence` in case a
      // future managed role (password reset) also provides one.
      Layer.provide(emailPersistence),
      Layer.provide(persistence),
      // Built from the same `persistence` value, so the build shares one instance and its setup.
      Layer.merge(sessionsReady),
      Layer.provide(emailEntry),
      Layer.provide(shared),
      Layer.provide(Auth.AuthConfig.layer({ secret })),
    )

  return {
    auth,
    provide,
    shared,
    layer: provide(auth.layer),
    sql,
    database,
    requirement,
  }
}
