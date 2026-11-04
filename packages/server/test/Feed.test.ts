import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { Database } from '../src/kernel/Db.ts'
import {
  bandsFor,
  byTaste,
  candidates,
  cursorOf,
  everyone,
  followedFirst,
  pageFrom,
  positionOf,
} from '../src/social/Feed.ts'
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
  Effect.flatMap(Database, (db) => candidates(db, 'ac_ana', { band: 0, at: new Date(before), id: '' }, everyone)).pipe(
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

describe('What’s new by taste (owner, 4 November 2026)', () => {
  it('puts what shares most of the reader’s saved aesthetics first, keeping the order otherwise; nothing shared keeps it', () => {
    const items = [
      { id: 'plain', shared: 0 },
      { id: 'poet', shared: 1 },
      { id: 'other', shared: 0 },
      { id: 'poetBrown', shared: 2 },
      { id: 'poetToo', shared: 1 },
    ]
    expect(byTaste(items, ({ shared }) => shared).map(({ id }) => id)).toEqual([
      'poetBrown',
      'poet',
      'poetToo',
      'plain',
      'other',
    ])
    expect(byTaste(items, () => 0).map(({ id }) => id)).toEqual(items.map(({ id }) => id))
  })
})

/** Thirty public boards of three people, published in turn: ten for women, ten for men and ten for everyone, the
 * newest last; Ana reads them, following Bea, who made the men's. */
const shelves = () => {
  const database = localD1()
  const rows = Array.from({ length: 30 }, (_, index) => {
    const audience = (['women', 'men', 'all'] as const)[index % 3] ?? 'all'
    return { id: `bd_${audience}${String(index).padStart(2, '0')}`.padEnd(25, 'x'), audience, at: 1000 + index }
  })
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 0, 'Ana', 0),
      ('ac_women', 0, 'W', 0), ('ac_men', 0, 'M', 0), ('ac_all', 0, 'A', 0);
    ${rows
      .map(
        ({ id, audience, at }) => `
      INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text, created_at,
          updated_at) VALUES ('${id}', 'ac_${audience}', '${id}', 'sand', 0, 'public', '[]', ${String(at)}, '', 0, 0);
      INSERT INTO board_tags (board_id, kind, value) VALUES ('${id}', 'audience', '${audience}');`,
      )
      .join('\n')}
  `)
  return { database, rows }
}

/** Ten of an audience, for the order a page is expected in. */
const ten = (audience: string) => Array.from({ length: 10 }, () => audience)

/** Every page in turn, from the first, by the cursor each page gives. */
const allPages = (database: ReturnType<typeof localD1>, choice: 'women' | 'men' | 'all' | null) =>
  Effect.gen(function* () {
    const db = yield* Database
    const bands = bandsFor(db, 'ac_ana', choice)
    const ids: Array<string> = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const { found, next } = yield* pageFrom(db, 'ac_ana', positionOf(cursor), bands)
      ids.push(...found.map(({ id }) => id))
      if (next === null) break
      cursor = cursorOf(next)
    }
    return ids
  }).pipe(Effect.provide(Database.layer(database)))

describe('What’s new by Show me', () => {
  it.effect('Women’s puts every women’s board before any men’s, and every board is still there', () =>
    Effect.gen(function* () {
      const { database, rows } = shelves()
      const ids = yield* allPages(database, 'women')
      const lastWomen = Math.max(
        ...rows.filter(({ audience }) => audience === 'women').map(({ id }) => ids.indexOf(id)),
      )
      const firstMen = Math.min(...rows.filter(({ audience }) => audience === 'men').map(({ id }) => ids.indexOf(id)))
      expect(lastWomen).toBeLessThan(firstMen)
      expect(ids.toSorted()).toEqual(rows.map(({ id }) => id).toSorted())
    }),
  )

  it.effect('Men’s does the reverse, the boards for everyone between', () =>
    Effect.gen(function* () {
      const { database, rows } = shelves()
      const ids = yield* allPages(database, 'men')
      const audiences = ids.map((id) => rows.find((row) => row.id === id)?.audience)
      expect(audiences).toEqual([...ten('men'), ...ten('all'), ...ten('women')])
    }),
  )

  it.effect('Everything, or no choice, keeps the publish order, newest first, page after page', () =>
    Effect.gen(function* () {
      const { database, rows } = shelves()
      const newestFirst = rows.map(({ id }) => id).toReversed()
      expect(yield* allPages(database, 'all')).toEqual(newestFirst)
      expect(yield* allPages(database, null)).toEqual(newestFirst)
    }),
  )

  it.effect('a person the reader follows stays first, whatever their boards are for', () =>
    Effect.gen(function* () {
      const { database, rows } = shelves()
      database.sqlite.exec("INSERT INTO follows (follower_id, followee_id, created_at) VALUES ('ac_ana', 'ac_men', 0)")
      const ids = yield* allPages(database, 'women')
      const first = ids.slice(0, 20).map((id) => rows.find((row) => row.id === id)?.audience)
      expect([
        first.filter((audience) => audience === 'men').length,
        first.filter((audience) => audience === 'women').length,
      ]).toEqual([10, 10])
      expect(ids).toHaveLength(30)
    }),
  )

  it('a cursor names its band and the last item, and one that does not read starts again from the top', () => {
    const position = { band: 1, at: new Date(1234), id: 'bd_x' }
    expect(positionOf(cursorOf(position))).toEqual(position)
    expect(positionOf('2026-11-04T08:00:00.000Z').band).toBe(0)
    expect(positionOf(undefined).id).toBe('')
  })
})
