import { describe, expect, it } from '@effect/vitest'
import { oauthClients } from '@styld/db'
import { OAuthServer } from '@yielded/auth'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { McpScope } from '../src/mcp/Policy.ts'
import { persistence, registeredClients } from '../src/mcp/OAuthStore.ts'
import { localD1 } from './LocalD1.ts'

// The MCP OAuth server's grants, assertion receipts and registered clients over D1: a lost race or a replay answers
// false, a revoked grant is never replaced, and rows read as the raw statements before them wrote them.

const random = (letter: string) => letter.repeat(43)

/** When the new client registered, as the Date its row stores. */
const registeredAt = new Date(1_700_000_000_000)

const record = (version: string, status: OAuthServer.Record['status']): OAuthServer.Record => ({
  version,
  status,
  authorization: {
    clientId: 'dcr_00000000000000000000000000000001',
    redirectUri: 'https://client.example/callback',
    scopes: [McpScope],
    challenge: random('c'),
  },
  expiresAtMillis: 1_900_000_000_000,
})

const setup = () => {
  const database = localD1()
  const db = drizzle(database)
  return { database, grants: persistence(db), clients: registeredClients(db), db }
}

describe('MCP OAuth persistence', () => {
  it.effect('a grant is written once, replaced only at its version, and stays revoked', () =>
    Effect.gen(function* () {
      const { database, grants } = setup()
      expect(yield* grants.insert('mcp', 'g1', record(random('a'), 'Pending'))).toBe(true)
      expect(yield* grants.insert('mcp', 'g1', record(random('b'), 'Pending'))).toBe(false)
      expect((yield* grants.get('mcp', 'g1'))?.version).toBe(random('a'))
      expect(yield* grants.get('mcp', 'missing')).toBeUndefined()

      expect(yield* grants.compareAndSet('mcp', 'g1', random('z'), record(random('b'), 'Active'))).toBe(false)
      expect(yield* grants.compareAndSet('mcp', 'g1', random('a'), record(random('b'), 'Active'))).toBe(true)
      expect((yield* grants.get('mcp', 'g1'))?.status).toBe('Active')

      yield* grants.revoke('mcp', 'g1')
      expect((yield* grants.get('mcp', 'g1'))?.status).toBe('Revoked')
      expect(yield* grants.compareAndSet('mcp', 'g1', random('b'), record(random('d'), 'Active'))).toBe(false)
      expect(
        database.sqlite.prepare('SELECT version, subject_id, expires_at FROM oauth_grants WHERE id = ?').get('g1'),
      ).toEqual({ version: random('b'), subject_id: null, expires_at: 1_900_000_000_000 })
    }),
  )

  it.effect('an assertion is consumed once', () =>
    Effect.gen(function* () {
      const { grants } = setup()
      const receipt = { id: 'jti-1', expiresAtMillis: 1_900_000_000_000 }
      expect(yield* grants.consumeAssertion('mcp', receipt)).toBe(true)
      expect(yield* grants.consumeAssertion('mcp', receipt)).toBe(false)
    }),
  )

  it.effect('a registered client reads back from the row as it is stored', () =>
    Effect.gen(function* () {
      const { database, clients, db } = setup()
      // A row as the raw statement wrote it before: a JSON array of redirect URIs and the time in milliseconds.
      database.sqlite.exec(
        `INSERT INTO oauth_clients (client_id, name, redirect_uris, application_type, created_at)
         VALUES ('dcr_00000000000000000000000000000001', 'Old', '["https://old.example/cb"]', 'web', 1700000000000)`,
      )
      expect(yield* clients.get('dcr_00000000000000000000000000000001')).toEqual({
        clientId: 'dcr_00000000000000000000000000000001',
        name: 'Old',
        redirectUris: ['https://old.example/cb'],
        applicationType: 'web',
        grantTypes: ['authorization_code', 'refresh_token'],
      })
      expect(yield* clients.get('dcr_ffffffffffffffffffffffffffffffff')).toBeUndefined()
      expect(yield* clients.get('not-ours')).toBeUndefined()

      // Registration writes the same bytes the raw statement did.
      yield* Effect.promise(() =>
        db.insert(oauthClients).values({
          clientId: 'dcr_00000000000000000000000000000002',
          name: 'New',
          redirectUris: ['http://127.0.0.1:3000/cb'],
          applicationType: 'native',
          createdAt: registeredAt,
        }),
      )
      expect(
        database.sqlite
          .prepare('SELECT redirect_uris, created_at FROM oauth_clients WHERE client_id = ?')
          .get('dcr_00000000000000000000000000000002'),
      ).toEqual({ redirect_uris: '["http://127.0.0.1:3000/cb"]', created_at: 1_700_000_000_000 })
    }),
  )
})
