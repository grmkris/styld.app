import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { Database, query } from '../src/kernel/Db.ts'
import { WardrobeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

// A category of the person's own lives on its pieces, under their type (owner, 2026-11-03, T-12): it is spelled as the
// account first spelled it, and renaming or deleting it moves only its own pieces.

const seeded = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  const piece = (id: string, type: string, category: string | null) =>
    database.sqlite
      .prepare(
        `INSERT INTO pieces (id, account_id, type, colours, occasions, category, status, source, original_key,
           content_type, created_at, updated_at)
         VALUES (?, 'ac_1', ?, '[]', '[]', ?, 'ready', 'website', 'k', 'image/png', 0, 0)`,
      )
      .run(id, type, category)
  piece('pc_1', 'sportswear', 'Ski pants')
  piece('pc_2', 'sportswear', 'Ski pants')
  piece('pc_3', 'trousers', 'Ski pants')
  piece('pc_4', 'sportswear', null)
  return database
}

/** When the renames happen; their time is not what is tested. */
const at = new Date(1)

const categories = (database: ReturnType<typeof seeded>) =>
  database.sqlite.prepare('SELECT id, category FROM pieces ORDER BY id').all()

describe("a category of the person's own", () => {
  it.effect('is found as the account spells it, whatever the case it is asked in, and only under its type', () => {
    const database = seeded()
    return Effect.gen(function* () {
      const store = yield* WardrobeStore
      expect(yield* store.categorySpelling('ac_1', 'sportswear', 'ski PANTS')).toBe('Ski pants')
      expect(yield* store.categorySpelling('ac_1', 'jeans', 'Ski pants')).toBeNull()
    }).pipe(Effect.provide(WardrobeStore.layer.pipe(Layer.provide(Database.layer(database)))))
  })

  it.effect('renamed moves its pieces under the type; deleted leaves them under the type alone', () => {
    const database = seeded()
    return Effect.gen(function* () {
      const store = yield* WardrobeStore
      yield* query(() => store.recategorise('ac_1', 'sportswear', 'ski pants', 'Snow trousers', at))
      expect(categories(database)).toEqual([
        { id: 'pc_1', category: 'Snow trousers' },
        { id: 'pc_2', category: 'Snow trousers' },
        { id: 'pc_3', category: 'Ski pants' },
        { id: 'pc_4', category: null },
      ])
      yield* query(() => store.recategorise('ac_1', 'sportswear', 'Snow trousers', null, at))
      expect(categories(database)).toEqual([
        { id: 'pc_1', category: null },
        { id: 'pc_2', category: null },
        { id: 'pc_3', category: 'Ski pants' },
        { id: 'pc_4', category: null },
      ])
    }).pipe(Effect.provide(WardrobeStore.layer.pipe(Layer.provide(Database.layer(database)))))
  })
})
