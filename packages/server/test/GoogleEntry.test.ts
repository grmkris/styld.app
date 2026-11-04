import { describe, expect, it } from '@effect/vitest'
import { accountOfEmail, createEmailAccount, googleAdopter } from '@styld/auth'
import { accounts } from '@styld/db'
import { OAuth } from '@yielded/auth'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Predicate, Schema } from 'effect'
import { decodeOAuthKeyring } from '../src/AuthConfiguration.ts'
import { localD1 } from './LocalD1.ts'

// Sign in with Google over real SQLite (owner, 4 November 2026: a verified Google address is the same person as the
// Styld account of that address). Yielded's own import is faked by a recorder that writes the identity row, as the
// managed persistence does, so a second sign-in finds it.

type Imported = { readonly subjectId: string; readonly subject: string }

const setup = () => {
  const database = localD1()
  const db = drizzle(database)
  const imported: Array<Imported> = []
  let counter = 0
  const imports = {
    importIdentity: (input: {
      readonly subjectId: string
      readonly provider: string
      readonly issuer: string
      readonly subject: string
    }) =>
      Effect.sync(() => {
        imported.push({ subjectId: input.subjectId, subject: input.subject })
        database.sqlite.exec(
          `INSERT INTO styld_auth_oauthIdentities (identity_key, provider, issuer, external_subject, subject_id)
           VALUES ('key_${input.subject}', '${input.provider}', '${input.issuer}', '${input.subject}', '${input.subjectId}')`,
        )
      }),
  }
  const token = Effect.sync(() => `token_${(counter += 1)}`.padEnd(43, 'x'))
  return { database, db, imported, adopt: googleAdopter(db, imports, token) }
}

const decodeVerified = Schema.decodeUnknownSync(OAuth.OAuthVerifiedExternalIdentity)

const verified = (subject: string, email: string | undefined, emailVerified = true, displayName?: string) =>
  decodeVerified({
    identity: { provider: 'google', issuer: 'https://accounts.google.com', subject },
    profile: {
      ...(email === undefined ? {} : { email, emailVerified }),
      ...(displayName === undefined ? {} : { displayName }),
    },
  })

const keyring = (material: string) => JSON.stringify({ activeKeyId: 'k1', keys: [{ id: 'k1', material }] })

const at = new Date(0)

describe('Sign in with Google', () => {
  it.effect('attaches a new Google identity to the account of its verified address', () =>
    Effect.gen(function* () {
      const { db, imported, adopt } = setup()
      yield* Effect.promise(() =>
        db.batch(
          createEmailAccount(db, {
            accountId: 'ac_ana',
            credentialId: 'cr_ana',
            securityRevision: 's',
            bindingRevision: 'b',
            credentialRevision: 'c',
            email: 'ana@example.com',
            displayName: 'Ana',
            at,
          }),
        ),
      )
      yield* adopt(verified('g-ana', 'Ana@Example.com'))
      expect(imported).toEqual([{ subjectId: 'ac_ana', subject: 'g-ana' }])
    }),
  )

  it.effect('makes an account for an address Styld has not seen, named as Google names the person', () =>
    Effect.gen(function* () {
      const { db, imported, adopt } = setup()
      yield* adopt(verified('g-mia', 'mia@example.com', true, 'Mia Novak'))
      const [found] = yield* Effect.promise(() => accountOfEmail(db, 'mia@example.com'))
      const made = yield* Effect.promise(() => db.select().from(accounts))
      expect(made.map(({ displayName }) => displayName)).toEqual(['Mia Novak'])
      expect(imported).toEqual([{ subjectId: found?.accountId, subject: 'g-mia' }])
    }),
  )

  it.effect('signs a known Google identity in without attaching it again', () =>
    Effect.gen(function* () {
      const { db, imported, adopt } = setup()
      yield* adopt(verified('g-mia', 'mia@example.com'))
      // Google now reports another address for the same person: the identity keeps its account.
      yield* adopt(verified('g-mia', 'mia.new@example.com'))
      expect(imported).toHaveLength(1)
      expect(yield* Effect.promise(() => db.select().from(accounts))).toHaveLength(1)
    }),
  )

  it.effect('refuses an address Google did not verify, or none, and makes nothing', () =>
    Effect.gen(function* () {
      const { db, imported, adopt } = setup()
      const unverified = yield* adopt(verified('g-x', 'x@example.com', false)).pipe(Effect.flip)
      const missing = yield* adopt(verified('g-y', undefined)).pipe(Effect.flip)
      expect(Predicate.isTagged(unverified, 'OAuthRejected')).toBe(true)
      expect(Predicate.isTagged(missing, 'OAuthRejected')).toBe(true)
      expect(imported).toEqual([])
      expect(yield* Effect.promise(() => db.select().from(accounts))).toHaveLength(0)
    }),
  )
})

describe('the Google sign-in keyring', () => {
  it.effect('takes 32-byte keys and keeps them redacted', () =>
    Effect.gen(function* () {
      const decoded = yield* decodeOAuthKeyring(keyring('a'.repeat(43)))
      expect(decoded.activeKeyId).toBe('k1')
      expect(JSON.stringify(decoded.keys)).not.toContain('aaaa')
    }),
  )

  it.effect('refuses a key of any other length', () =>
    Effect.gen(function* () {
      const error = yield* decodeOAuthKeyring(keyring('a'.repeat(44))).pipe(Effect.flip)
      expect(error).toMatchObject({ reason: 'oauth-keys' })
    }),
  )
})
