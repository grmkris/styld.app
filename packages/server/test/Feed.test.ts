import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { Database } from '../src/kernel/Db.ts'
import { candidates, followedFirst } from '../src/social/Feed.ts'
import { localD1 } from './LocalD1.ts'

// What's new on Home (Eva, owner 4 November): everyone's public things, newest first, never the reader's own; a pin
// counts when it is added to a board already public, so a board made public with all its pins arrives once, not as a
// flood. The people the reader follows come first on each page.

/** Ana reads; Luka has a public board (published at 100, one pin from before and one after), a private board with a
 * pin, and a shared look; Ana has a public board of her own. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 0, 'Ana', 0),
      ('ac_luka', 0, 'Luka', 0);
    INSERT INTO looks (id, account_id, name, created_at, shared_at) VALUES
      ('lk_shared', 'ac_luka', 'Rain', 0, 120), ('lk_kept', 'ac_luka', 'Kept', 0, NULL), ('lk_ana', 'ac_ana', 'Mine', 0, 130);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text, created_at,
        updated_at) VALUES
      ('bd_public', 'ac_luka', 'Coats', 'sand', 0, 'public', '[]', 100, ' coats', 0, 0),
      ('bd_private', 'ac_luka', 'Draft', 'sand', 0, 'private', '[]', NULL, ' draft', 0, 0),
      ('bd_ana', 'ac_ana', 'Mine', 'sand', 0, 'public', '[]', 140, ' mine', 0, 0);
    INSERT INTO board_pins (id, board_id, kind, look_id, created_at) VALUES
      ('pn_before', 'bd_public', 'look', 'lk_kept', 50),
      ('pn_after', 'bd_public', 'look', 'lk_shared', 150),
      ('pn_private', 'bd_private', 'look', 'lk_shared', 160),
      ('pn_ana', 'bd_ana', 'look', 'lk_ana', 170);
  `)
  return database
}

const newest = (database: ReturnType<typeof seeded>, before: number) =>
  Effect.flatMap(Database, (db) => candidates(db, 'ac_ana', new Date(before))).pipe(
    Effect.provide(Database.layer(database)),
  )

describe("What's new", () => {
  it.effect('shows everyone’s public things newest first, never the reader’s own, and a pin only once public', () =>
    Effect.gen(function* () {
      const found = yield* newest(seeded(), 8.64e15)
      expect(found.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
        'pin:pn_after',
        'look:lk_shared',
        'board:bd_public',
      ])
    }),
  )

  it.effect('a page starts before the cursor', () =>
    Effect.gen(function* () {
      const found = yield* newest(seeded(), 120)
      expect(found.map(({ kind, id }) => `${kind}:${id}`)).toEqual(['board:bd_public'])
    }),
  )

  it('puts the people the reader follows first, each part in its order, and no one more than twice in a row', () => {
    const items = ['a1', 'a2', 'a3', 'b1', 'c1', 'b2'].map((id) => ({ id, person: id.slice(0, 1) }))
    const ordered = followedFirst(items, new Set(['b']), ({ person }) => person)
    expect(ordered.map(({ id }) => id)).toEqual(['b1', 'b2', 'a1', 'a2', 'c1', 'a3'])
  })
})
