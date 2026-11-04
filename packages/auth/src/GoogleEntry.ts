import { Google, OAuth, Schema as AuthSchema } from '@yielded/auth'
import type { ProviderDefinition } from '@yielded/auth/OAuth'
import { type IdentityImport, IdentityImports } from '@yielded/auth-persistence/OAuthPersistence'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { DateTime, Effect, Option, Predicate, type Redacted } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as SecureRandom from 'effect/crypto/SecureRandom'

import type { D1Source } from './AttemptLimiter.ts'
import { accountOfEmail, createEmailAccount } from './Provisioning.ts'
import { AppAuth, oauthIdentities } from './storage.ts'

/** The Google OAuth client (v1's, reused): its id and secret. */
export interface GoogleClient {
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted
}

/** The Google strategy's module id, which owns each account's Google identity. */
const moduleId = OAuth.OAuthModuleId.make(AppAuth.strategies.google.persistence.moduleId)

/** What Google proved: who signed in, by its stable subject, and the address it verified, if any. */
type Verified = Effect.Success<ReturnType<OAuth.OAuthProtocol['Service']['exchangeVerifiedIdentity']>>

/** A display name Styld keeps: Google's name, else the address before the @, at most 64 characters. */
const nameFor = (profile: Verified['profile'], email: string) =>
  (profile?.displayName?.trim() || email.slice(0, Math.max(1, email.indexOf('@')))).slice(0, 64)

/** Google is not offered: no client is configured, or Google could not be reached when this isolate set it up. */
const unavailable: OAuth.OAuthProtocol['Service'] = {
  prepareAuthorization: () => Effect.fail(OAuth.OAuthUnavailable.make({})),
  exchangeVerifiedIdentity: () => Effect.fail(OAuth.OAuthUnavailable.make({})),
}

type Database = ReturnType<typeof drizzle>

/**
 * Attaches a Google identity Yielded does not know yet to the account of the address Google verified, making that
 * account first when there is none (as email-code registration makes one, so a later code reaches it too). A known
 * identity is left as it is; an address Google did not verify is refused (`OAuthRejected`).
 */
export const googleAdopter = (
  db: Database,
  imports: { readonly importIdentity: (input: IdentityImport) => Effect.Effect<unknown, OAuth.OAuthUnavailable> },
  token: Effect.Effect<string>,
) => {
  const ownerOf = (identity: Verified['identity']) =>
    Effect.tryPromise(() =>
      db.all<{ readonly subjectId: string }>(
        sql`select subject_id as subjectId from ${oauthIdentities}
            where provider = ${identity.provider} and issuer = ${identity.issuer}
              and external_subject = ${identity.subject} limit 1`,
      ),
    ).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]?.subjectId)))

  const accountFor = (email: string, profile: Verified['profile']) =>
    Effect.gen(function* () {
      const found = yield* Effect.tryPromise(() => accountOfEmail(db, email))
      if (found[0] !== undefined) return found[0].accountId
      const account = {
        accountId: yield* token,
        credentialId: yield* token,
        securityRevision: yield* token,
        bindingRevision: yield* token,
        credentialRevision: yield* token,
        email,
        displayName: nameFor(profile, email),
        at: DateTime.toDate(yield* DateTime.now),
      }
      yield* Effect.tryPromise(() => db.batch(createEmailAccount(db, account)))
      return account.accountId
    })

  return Effect.fn('Styld.Auth.google.adopt')(function* (verified: Verified) {
    if (Option.isSome(yield* ownerOf(verified.identity))) return
    const email = verified.profile?.email?.trim().toLowerCase()
    if (email === undefined || verified.profile?.emailVerified !== true) return yield* OAuth.OAuthRejected.make({})
    const subjectId = yield* accountFor(email, verified.profile)
    yield* imports.importIdentity({ moduleId, subjectId: AuthSchema.SubjectId.make(subjectId), ...verified.identity })
  })
}

/**
 * Sign in with Google, with one rule Yielded leaves to the application: a Google address that Google verified is the
 * same person as the Styld account of that address (the owner's decision of 4 November 2026, as on v1). Yielded only
 * signs in an identity it already knows, so before it looks, an unknown Google identity is attached to the account of
 * its verified email, or to an account made for it the way email-code registration makes one (so a later email code
 * reaches it too). An address Google did not verify is refused. Attaching advances the account's security revision,
 * which signs its other sessions out once.
 *
 * Google's own sign-in time is dropped: Google has just checked the person, and an older `auth_time` from a long-lived
 * Google session would otherwise fail the five-minute requirement.
 */
export const googleProvider = <R>(client: Option.Option<GoogleClient>, raw: D1Source<R>) => ({
  configure: (binding: Parameters<ProviderDefinition['configure']>[0]) =>
    Effect.gen(function* () {
      if (Option.isNone(client)) return unavailable
      const imports = yield* IdentityImports
      const random = yield* SecureRandom.SecureRandom
      const db = drizzle(yield* raw)
      const google = yield* Google.provider({
        clientId: client.value.clientId,
        clientSecret: client.value.clientSecret,
        scopes: ['openid', 'email', 'profile'],
      })
        .configure(binding)
        .pipe(
          Effect.tapCause(() => Effect.logWarning('Styld.Auth.googleUnavailable')),
          Effect.option,
        )
      if (Option.isNone(google)) return unavailable
      const adopt = googleAdopter(db, imports, random.randomBytes(32).pipe(Effect.map(Base64Url.encode)))

      return OAuth.OAuthProtocol.of({
        prepareAuthorization: google.value.prepareAuthorization,
        exchangeVerifiedIdentity: (input) =>
          google.value.exchangeVerifiedIdentity(input).pipe(
            Effect.tap((verified) =>
              adopt(verified).pipe(
                Effect.mapError((error) =>
                  Predicate.isTagged(error, 'OAuthRejected')
                    ? OAuth.OAuthProtocolRejected.make({})
                    : OAuth.OAuthUnavailable.make({}),
                ),
              ),
            ),
            Effect.map(({ upstreamAuthenticatedAt: _dropped, ...verified }) => verified),
          ),
      })
    }),
})
