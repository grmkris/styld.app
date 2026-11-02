import { describe, expect, test } from 'vitest'
import { auditServerFile } from './patterns.ts'

// The patterns gate resolves names through imports: a table, a drizzle or a transport is caught under any alias or
// namespace, and a local of the same spelling that imports nothing is not.

describe('table ownership', () => {
  test('a write to another module’s table is caught by name, alias and namespace', () => {
    const named = `import { pieces } from '@styld/db'; db.update(pieces).set({})`
    const aliased = `import { pieces as things } from '@styld/db'; db.update(things).set({})`
    const namespaced = `import * as tables from '@styld/db'; db.update(tables.pieces).set({})`
    for (const source of [named, aliased, namespaced])
      expect(auditServerFile('boards/Boards.ts', source)).toEqual(['.update(pieces) outside its owner (wardrobe/)'])
  })

  test('the owner writes its own tables, and a local named like a table is no table', () => {
    expect(
      auditServerFile('wardrobe/Store.ts', `import * as tables from '@styld/db'; db.delete(tables.pieces)`),
    ).toEqual([])
    expect(auditServerFile('boards/Boards.ts', `const pieces = []; db.update(pieces)`)).toEqual([])
  })
})

describe('one database', () => {
  test('drizzle( is caught by name, alias and namespace outside kernel/Db.ts', () => {
    for (const source of [
      `import { drizzle } from 'drizzle-orm/d1'; drizzle(env.DB)`,
      `import { drizzle as makeDb } from 'drizzle-orm/d1'; makeDb(binding)`,
      `import * as d1 from 'drizzle-orm/d1'; d1.drizzle(binding)`,
    ])
      expect(auditServerFile('boards/Store.ts', source)).toContain(
        'drizzle( outside kernel/Db.ts; take the Database service',
      )
    expect(auditServerFile('kernel/Db.ts', `import { drizzle } from 'drizzle-orm/d1'; drizzle(binding)`)).toEqual([])
  })

  test('a type-only drizzle import makes no database', () => {
    expect(
      auditServerFile('kernel/Receipts.ts', `import type { drizzle } from 'drizzle-orm/d1'; type D = typeof drizzle`),
    ).toEqual([])
  })
})

describe('external calls', () => {
  test('an HTTP transport made outside providers/ is caught, as a raw fetch is', () => {
    expect(
      auditServerFile(
        'mcp/ImageImport.ts',
        `import * as FetchHttpClient from 'effect/http/FetchHttpClient'; FetchHttpClient.layer`,
      ),
    ).toEqual(["effect/http/FetchHttpClient imported outside providers/; send requests through a provider's adapter"])
    expect(auditServerFile('links/Links.ts', `fetch('https://shop.test')`)).toEqual([
      'fetch( outside providers/; call the provider through its adapter',
    ])
  })

  test('providers make their transports', () => {
    expect(
      auditServerFile(
        'providers/PublicWeb.ts',
        `import * as FetchHttpClient from 'effect/http/FetchHttpClient'; fetch(url)`,
      ),
    ).toEqual([])
  })
})
