import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, NotFound } from '@styld/protocol'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect } from 'effect'
import { AccountLifecycle, makeAccountLifecycle } from '../src/AccountLifecycle.ts'
import { localD1 } from './LocalD1.ts'

// The one account read (HTTP and MCP alike): the account an operation acts for, while it is enabled, with only the
// email it signs in with, active and verified.

const notUsed = () => Promise.reject(new Error('not used'))

const accounts = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 'r', 'Ana', 0);
    INSERT INTO accounts (id, enabled, security_revision, display_name, created_at) VALUES ('ac_gone', 0, 'r', 'Gone', 0);
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_new', 'r', 'New', 0);
    INSERT INTO styld_auth_identifiers (namespace, value, module_id, credential_id, subject_id, revision, verified_at, active)
      VALUES ('email', 'ana@example.com', 'm', 'c1', 'ac_ana', 'r', 1, 1),
             ('email', 'old@example.com', 'm', 'c2', 'ac_ana', 'r', 1, 0),
             ('email', 'new@example.com', 'm', 'c3', 'ac_new', 'r', NULL, 1);
  `)
  return makeAccountLifecycle(
    { database, bucket: { list: notUsed, delete: notUsed }, queue: { send: notUsed } },
    () => Effect.void,
  ).pipe(Effect.provide(layerCryptoWeb))
}

const readAs = (accountId: string) =>
  Effect.flatMap(accounts(), (lifecycle: AccountLifecycle['Service']) =>
    lifecycle.readAccount().pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' })),
  )

describe('reading the account', () => {
  it.effect('answers its name and the active, verified email it signs in with', () =>
    Effect.gen(function* () {
      expect(yield* readAs('ac_ana')).toEqual({ accountId: 'ac_ana', displayName: 'Ana', email: 'ana@example.com' })
      expect(yield* readAs('ac_new')).toEqual({ accountId: 'ac_new', displayName: 'New', email: null })
    }),
  )

  it.effect('does not find a closed account, so its assistants lose access', () =>
    Effect.gen(function* () {
      expect(yield* readAs('ac_gone').pipe(Effect.flip)).toBeInstanceOf(NotFound)
      expect(yield* readAs('ac_nobody').pipe(Effect.flip)).toBeInstanceOf(NotFound)
    }),
  )
})
