import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount } from '@styld/protocol'
import * as WebCrypto from '@yielded/auth/WebCrypto'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { type AccountLifecycle, makeAccountLifecycle } from '../src/AccountLifecycle.ts'
import { handleOwner, profileOf } from '../src/social/ProfileStore.ts'
import { localD1 } from './LocalD1.ts'

// Deleting an account is durable: closing access records it, and the record stays until every store is purged, so an
// outage of the bucket through every queue attempt only delays the purge. The account's public profile is gone from
// the first moment, and an object an in-flight writer leaves under the prefix after the purge goes in the last one.

/** Ana, published as `ana`, with one session. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 'r', 'Ana', 0);
    INSERT INTO profiles (account_id, handle, name, tone, published, house, search_text, created_at, updated_at)
      VALUES ('ac_ana', 'ana', 'Ana', 'sand', 1, 0, ' ana', 0, 0);
  `)
  return database
}

/** A bucket that is down until `up` is set, holding the keys put in it; the outside stores, counting their purges. */
const world = () => {
  const objects = new Set(['accounts/ac_ana/pieces/pc_1/photo.jpg'])
  const state = { up: false, chats: 0, providerFiles: 0, queued: 0 }
  const bucket = {
    list: async ({ prefix }: { readonly prefix: string }) => {
      if (!state.up) throw new Error('R2 is down')
      return { objects: [...objects].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }
    },
    delete: async (keys: Array<string>) => {
      for (const key of keys) objects.delete(key)
    },
  }
  const outside = {
    chats: () => Effect.sync(() => void (state.chats += 1)),
    providerFiles: () => Effect.sync(() => void (state.providerFiles += 1)),
  }
  const queue = {
    send: async () => {
      state.queued += 1
      throw new Error('the queue is down too')
    },
  }
  return { objects, state, bucket, outside, queue }
}

const lifecycleOver = (database: ReturnType<typeof localD1>, outside: ReturnType<typeof world>) =>
  makeAccountLifecycle(
    { database: drizzle(database), bucket: outside.bucket, queue: outside.queue },
    outside.outside,
  ).pipe(Effect.provide(WebCrypto.layer))

const deletions = (database: ReturnType<typeof localD1>) =>
  database.sqlite.prepare('SELECT account_id, purged_at FROM account_deletions').all()

/** Ana's and Bo's sign-in rows in every auth table, and a code sent to each address. */
const withAuthRows = (database: ReturnType<typeof localD1>) => {
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_bo', 'r', 'Bo', 0);
    INSERT INTO styld_auth_identifiers (namespace, value, module_id, credential_id, subject_id, revision, verified_at, active)
      VALUES ('email', 'old@example.com', 'm', 'c0', 'ac_ana', 'r', 1, 0), ('email', 'ana@example.com', 'm', 'c1', 'ac_ana', 'r', NULL, 1),
        ('email', 'ana.verified@example.com', 'm', 'c2', 'ac_ana', 'r', 1, 1), ('email', 'bo@example.com', 'm', 'c3', 'ac_bo', 'r', 1, 1);
    INSERT INTO styld_auth_credentials (credential_id, subject_id, revision, active) VALUES ('c1', 'ac_ana', 'r', 1), ('c3', 'ac_bo', 'r', 1);
    INSERT INTO styld_auth_passwords (module_id, subject_id, credential_id, credential_revision, verifier_version, verifier, normalization)
      VALUES ('m', 'ac_ana', 'c1', 'r', 'v', 'x', 'none'), ('m', 'ac_bo', 'c3', 'r', 'v', 'x', 'none');
    INSERT INTO styld_auth_sessions (session_id, subject_id, digest, security_revision, issued_at, expires_at, absolute_expires_at, record)
      VALUES ('s1', 'ac_ana', 'd1', 'r', 0, 1, 1, '{}'), ('s2', 'ac_bo', 'd2', 'r', 0, 1, 1, '{}');
    INSERT INTO styld_auth_email_credentials (module_id, subject_id, credential_id, identifier_namespace, identifier_value, credential_revision, active)
      VALUES ('e', 'ac_ana', 'c1', 'email', 'ana@example.com', 'r', 1), ('e', 'ac_bo', 'c3', 'email', 'bo@example.com', 'r', 1);
    INSERT INTO styld_auth_proofs (module_id, purpose, series_key, proof_id, binding, verifier_key_id, verifier_digest, issued_at, expires_at, failed_attempts)
      VALUES ('e', 'signIn', 'k1', 'p1', '{"identifier":{"value":"ana@example.com"}}', 'v', 'd', 0, 1, 0),
        ('e', 'signIn', 'k2', 'p2', '{"identifier":{"value":"bo@example.com"}}', 'v', 'd', 0, 1, 0);
    INSERT INTO styld_auth_oauthIdentities (identity_key, provider, issuer, external_subject, subject_id)
      VALUES ('g1', 'google', 'https://accounts.google.com', 'x1', 'ac_ana'), ('g2', 'google', 'https://accounts.google.com', 'x2', 'ac_bo');
    INSERT INTO styld_auth_oauthCredentials (module_id, credential_id, subject_id, identity_key, credential_revision, active)
      VALUES ('g', 'gc1', 'ac_ana', 'g1', 'r', 1), ('g', 'gc2', 'ac_bo', 'g2', 'r', 1);
  `)
  return database
}

const authTableNames = [
  'styld_auth_identifiers',
  'styld_auth_credentials',
  'styld_auth_passwords',
  'styld_auth_sessions',
  'styld_auth_email_credentials',
  'styld_auth_oauthIdentities',
  'styld_auth_oauthCredentials',
]

describe('the account’s own rows', () => {
  it.effect('read its name and its one active, verified email address', () => {
    const database = withAuthRows(seeded())
    const outside = world()
    return Effect.gen(function* () {
      const lifecycle: AccountLifecycle['Service'] = yield* lifecycleOver(database, outside)
      expect(yield* lifecycle.readAccount()).toEqual({
        accountId: 'ac_ana',
        displayName: 'Ana',
        email: 'ana.verified@example.com',
      })
    }).pipe(Effect.provideService(CurrentAccount, { accountId: 'ac_ana', via: 'session' }))
  })

  it.effect('go with it from every auth table, codes sent to its addresses too, and nobody else’s', () => {
    const database = withAuthRows(seeded())
    const outside = world()
    outside.state.up = true
    return Effect.gen(function* () {
      const lifecycle: AccountLifecycle['Service'] = yield* lifecycleOver(database, outside)
      yield* lifecycle.deleteAccount('ac_ana')
      for (const table of authTableNames)
        expect(database.sqlite.prepare(`SELECT DISTINCT subject_id FROM ${table}`).all()).toEqual([
          { subject_id: 'ac_bo' },
        ])
      expect(database.sqlite.prepare('SELECT proof_id FROM styld_auth_proofs').all()).toEqual([{ proof_id: 'p2' }])
      expect(database.sqlite.prepare('SELECT id FROM accounts').all()).toEqual([{ id: 'ac_bo' }])
    })
  })
})

describe('deleting an account', () => {
  it.effect('is recorded as access closes, hides the profile at once, and is finished by the sweep', () => {
    const database = seeded()
    const outside = world()
    return Effect.gen(function* () {
      const lifecycle: AccountLifecycle['Service'] = yield* lifecycleOver(database, outside)
      const db = drizzle(database)
      yield* lifecycle.deleteAccount('ac_ana')
      // Closed, recorded and hidden, though the bucket and the queue were down.
      expect(database.sqlite.prepare('SELECT enabled FROM accounts').all()).toEqual([{ enabled: 0 }])
      expect(deletions(database)).toEqual([{ account_id: 'ac_ana', purged_at: null }])
      expect(yield* handleOwner(db, 'ana', 'published')).toEqual(Option.none())
      expect(yield* profileOf(db, 'ac_ana')).toEqual(Option.none())
      // The bucket is back. The sweep leaves a fresh deletion to its queue message, then finishes it.
      outside.state.up = true
      expect(yield* lifecycle.sweepDeletions()).toBe(0)
      yield* TestClock.adjust('11 minutes')
      expect(yield* lifecycle.sweepDeletions()).toBe(1)
      expect(database.sqlite.prepare('SELECT id FROM accounts').all()).toEqual([])
      expect(database.sqlite.prepare('SELECT account_id FROM profiles').all()).toEqual([])
      expect([...outside.objects]).toEqual([])
      expect(outside.state).toMatchObject({ chats: 1, providerFiles: 1 })
      expect(deletions(database)).toEqual([{ account_id: 'ac_ana', purged_at: 11 * 60_000 }])
    }).pipe(Effect.provideService(CurrentAccount, { accountId: 'ac_ana', via: 'session' }))
  })

  it.effect('keeps its record until writers admitted before it drained, then purges the prefix a last time', () => {
    const database = seeded()
    const outside = world()
    outside.state.up = true
    return Effect.gen(function* () {
      const lifecycle: AccountLifecycle['Service'] = yield* lifecycleOver(database, outside)
      yield* lifecycle.deleteAccount('ac_ana')
      expect(deletions(database)).toEqual([{ account_id: 'ac_ana', purged_at: 0 }])
      // A cut-out that started before the deletion lands its picture after the purge.
      outside.objects.add('accounts/ac_ana/pieces/pc_1/cutout.png')
      yield* TestClock.adjust('23 hours')
      expect(yield* lifecycle.sweepDeletions()).toBe(0)
      expect([...outside.objects]).toEqual(['accounts/ac_ana/pieces/pc_1/cutout.png'])
      yield* TestClock.adjust('2 hours')
      expect(yield* lifecycle.sweepDeletions()).toBe(1)
      expect([...outside.objects]).toEqual([])
      expect(outside.state).toMatchObject({ chats: 2, providerFiles: 2 })
      expect(deletions(database)).toEqual([])
    })
  })
})
