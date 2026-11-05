import { describe, expect, test } from 'vitest'
import { auditRawSql, auditServerFile } from './patterns.ts'

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

  test('billing owns memberships', () => {
    const write = `import { memberships } from '@styld/db'; db.update(memberships).set({})`
    expect(auditServerFile('billing/Store.ts', write)).toEqual([])
    expect(auditServerFile('social/Social.ts', write)).toEqual(['.update(memberships) outside its owner (billing/)'])
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
        'links/ImageImport.ts',
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

describe('Drizzle builds every statement', () => {
  const file = 'packages/server/src/billing/Store.ts'
  const whole = 'a whole statement in an sql template; build it with Drizzle'

  test("a whole statement or text subquery in Drizzle's sql template is caught by name, alias and namespace", () => {
    for (const source of [
      'import { sql } from "drizzle-orm"; const s = sql`  SELECT id FROM ${pieces}`',
      'import { sql as raw } from "drizzle-orm"; const s = raw`with x as (select 1) select * from x`',
      'import * as orm from "drizzle-orm"; const s = orm.sql`delete from ${pieces}`',
      'import { sql } from "drizzle-orm"; const s = sql`(select ${accounts.id} from ${accounts})`',
      'import { sql } from "drizzle-orm"; const s = sql`exists (select 1 from ${accounts})`',
    ])
      expect(auditRawSql(file, source)).toEqual([whole])
  })

  test('a statement run straight from a template is caught, with the statement it spells', () => {
    expect(auditRawSql(file, 'import { sql } from "drizzle-orm"; db.run(sql`update ${accounts} set x = 1`)')).toEqual([
      '.run(sql`…`) runs a raw statement; build it with Drizzle',
      whole,
    ])
    expect(auditRawSql(file, 'import { sql } from "drizzle-orm"; db.all(sql`${statement}`)')).toEqual([
      '.all(sql`…`) runs a raw statement; build it with Drizzle',
    ])
  })

  test('a text subquery inside an expression, and a statement in sql.raw, are caught', () => {
    expect(
      auditRawSql(file, 'import { sql } from "drizzle-orm"; sql`${accounts.id} in (select id from ${accounts})`'),
    ).toEqual([
      "a subquery spelled as text in an sql template; pass Drizzle's builder (exists(…), inArray(…), sql`${…}`)",
    ])
    expect(auditRawSql(file, 'import { sql } from "drizzle-orm"; sql.raw("insert into t values (1)")')).toEqual([
      'a whole statement in sql.raw; build it with Drizzle',
    ])
  })

  test('the D1 client under Drizzle is caught', () => {
    expect(auditRawSql('packages/server/src/mcp/OAuth.ts', 'db.$client.prepare("select 1").all()')).toEqual([
      '.prepare(…) of an SQL string; build the statement with Drizzle over the Database service',
      "$client reaches the D1 client under Drizzle; use Drizzle's builder",
    ])
  })

  test('expression fragments without a helper, builders wrapped as subqueries and look-alikes stay', () => {
    for (const source of [
      'import { sql } from "drizzle-orm"; sql`${counts.n} + 1`',
      'import { sql } from "drizzle-orm"; sql`excluded.until`',
      "import { sql } from \"drizzle-orm\"; sql`CASE WHEN ${uploads.status} = 'received' THEN 'used' END`",
      'import { sql } from "drizzle-orm"; sql`(${db.select().from(boards)})`',
      'auth.prepare({ evidence })',
      'const sql = (parts) => parts; sql`select 1`; html`<select>`',
    ])
      expect(auditRawSql(file, source)).toEqual([])
  })
})
