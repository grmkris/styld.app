import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { makeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

// The wardrobe's search reads only the account's ready pieces from the store, newest first, of the type and pattern it
// names; the words and the rest are matched on those rows (`wardrobe/Search.ts`, protocol `PieceSearch.ts`).

const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_2', 0, 'Bob', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, pattern, status, source, original_key, content_type,
        created_at, updated_at)
      VALUES
        ('pc_old', 'ac_1', 'jeans', '[]', '[]', 'plain', 'ready', 'website', 'k1', 'image/jpeg', 1, 1),
        ('pc_new', 'ac_1', 'jeans', '[]', '[]', 'striped', 'ready', 'website', 'k2', 'image/jpeg', 3, 3),
        ('pc_tee', 'ac_1', 'shortSleeveTops', '[]', '[]', 'plain', 'ready', 'website', 'k3', 'image/jpeg', 2, 2),
        ('pc_wip', 'ac_1', 'jeans', '[]', '[]', 'plain', 'processing', 'website', 'k4', 'image/jpeg', 4, 4),
        ('pc_bob', 'ac_2', 'jeans', '[]', '[]', 'plain', 'ready', 'website', 'k5', 'image/jpeg', 5, 5);
  `)
  return makeStore(drizzle(database))
}

describe("the wardrobe search's rows", () => {
  it.effect("are the account's ready pieces, newest first", () =>
    Effect.gen(function* () {
      const rows = yield* seeded().readyPieces('ac_1', {})
      expect(rows.map(({ id }) => id)).toEqual(['pc_new', 'pc_tee', 'pc_old'])
    }),
  )

  it.effect('keep to the type and pattern asked for', () =>
    Effect.gen(function* () {
      const store = seeded()
      expect((yield* store.readyPieces('ac_1', { type: 'jeans' })).map(({ id }) => id)).toEqual(['pc_new', 'pc_old'])
      expect((yield* store.readyPieces('ac_1', { type: 'jeans', pattern: 'plain' })).map(({ id }) => id)).toEqual([
        'pc_old',
      ])
    }),
  )
})
