import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { localD1 } from './LocalD1.ts'

// The house boards' tables (owner, 4 November 2026): tags, translations, the seed's own receipts, where a house piece's
// picture came from, and the reader's Show me. All are new tables, so the migration rebuilds nothing; each holds only
// what its CHECKs allow, and each row goes with the account, board or piece it belongs to.

const migrations = new URL('../../db/migrations/', import.meta.url)
const folder = readdirSync(migrations).find((name) => name.endsWith('_house_seed_tags'))

/** Two accounts, a board of Ana's with a piece pinned on it, and one row in each new table for them. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 0, 'Ana', 0),
      ('ac_luka', 0, 'Luka', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key, content_type,
        created_at, updated_at)
      VALUES ('pc_coat', 'ac_ana', 'coats', '["navy"]', '[]', 'ready', 'import', 'o', 'i', 'image/png', 0, 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text, created_at,
        updated_at)
      VALUES ('bd_coats', 'ac_ana', 'Coats', 'sand', 0, 'public', '[]', 100, ' coats', 0, 0);
    INSERT INTO board_tags (board_id, kind, value) VALUES ('bd_coats', 'audience', 'women'),
      ('bd_coats', 'season', 'winter');
    INSERT INTO board_translations (board_id, locale, name, labels, source_digest, updated_at)
      VALUES ('bd_coats', 'sl', 'Plašči', '{}', 'digest', 0);
    INSERT INTO profile_translations (account_id, locale, name, bio, source_digest, updated_at)
      VALUES ('ac_ana', 'sl', 'Ana', 'Plašči.', 'digest', 0);
    INSERT INTO seeded_boards (account_id, seed_id, board_id, version, digest)
      VALUES ('ac_ana', 'w-coats', 'bd_coats', 1, 'digest');
    INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, model, prompt_digest, updated_at)
      VALUES ('pc_coat', 'ac_ana', 'generated', 'w-coats-navy', 'muse-image-1.0', 'digest', 0);
    INSERT INTO viewer_preferences (account_id, show_me, show_me_asked_at) VALUES ('ac_luka', 'men', 0);
  `)
  return database.sqlite
}

type Sqlite = ReturnType<typeof seeded>

const count = (sqlite: Sqlite, table: string) =>
  Number(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'])

describe('the house boards’ tables', () => {
  test('the migration only adds tables and indexes, so no table is rebuilt', () => {
    expect(folder).toBeDefined()
    const statements = readFileSync(new URL(`${String(folder)}/migration.sql`, migrations), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) /u)
  })

  test('each CHECK refuses a value outside its list', () => {
    const sqlite = seeded()
    const outside = [
      "INSERT INTO board_tags (board_id, kind, value) VALUES ('bd_coats', 'colour', 'red')",
      "INSERT INTO board_translations (board_id, locale, name, labels, source_digest, updated_at) VALUES ('bd_coats', 'de', 'x', '{}', 'd', 0)",
      "UPDATE board_translations SET labels = '[]' WHERE board_id = 'bd_coats'",
      "UPDATE board_translations SET review = 'done' WHERE board_id = 'bd_coats'",
      "UPDATE profile_translations SET locale = 'hr' WHERE account_id = 'ac_ana'",
      "UPDATE profile_translations SET review = 'later' WHERE account_id = 'ac_ana'",
      "UPDATE piece_provenance SET origin = 'scraped' WHERE piece_id = 'pc_coat'",
      "UPDATE piece_provenance SET described_type = 'tops' WHERE piece_id = 'pc_coat'",
      "UPDATE viewer_preferences SET show_me = 'kids' WHERE account_id = 'ac_luka'",
    ]
    for (const statement of outside) expect(() => sqlite.exec(statement)).toThrow(/CHECK constraint/u)
  })

  test('nothing is required beyond the choice: no Show me is Everything, not yet asked', () => {
    const sqlite = seeded()
    sqlite.exec("INSERT INTO viewer_preferences (account_id) VALUES ('ac_ana')")
    expect(
      sqlite.prepare("SELECT show_me, show_me_asked_at FROM viewer_preferences WHERE account_id = 'ac_ana'").get(),
    ).toEqual({ show_me: null, show_me_asked_at: null })
  })

  test('a deleted board takes its tags, translation and seed row with it', () => {
    const sqlite = seeded()
    sqlite.exec("DELETE FROM boards WHERE id = 'bd_coats'")
    expect([count(sqlite, 'board_tags'), count(sqlite, 'board_translations'), count(sqlite, 'seeded_boards')]).toEqual([
      0, 0, 0,
    ])
  })

  test('a deleted piece takes its provenance with it', () => {
    const sqlite = seeded()
    sqlite.exec("DELETE FROM pieces WHERE id = 'pc_coat'")
    expect(count(sqlite, 'piece_provenance')).toBe(0)
  })

  test('a deleted account takes every row of these tables that is its own', () => {
    const sqlite = seeded()
    sqlite.exec("DELETE FROM accounts WHERE id IN ('ac_ana', 'ac_luka')")
    for (const table of [
      'board_tags',
      'board_translations',
      'profile_translations',
      'seeded_boards',
      'piece_provenance',
      'viewer_preferences',
    ])
      expect({ table, rows: count(sqlite, table) }).toEqual({ table, rows: 0 })
  })

  test('one manifest id is one piece per account', () => {
    const sqlite = seeded()
    sqlite.exec(`
      INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key,
          content_type, created_at, updated_at)
        VALUES ('pc_coat_2', 'ac_ana', 'coats', '["navy"]', '[]', 'ready', 'import', 'o2', 'i2', 'image/png', 0, 0)`)
    expect(() =>
      sqlite.exec(
        "INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, updated_at) VALUES ('pc_coat_2', 'ac_ana', 'generated', 'w-coats-navy', 0)",
      ),
    ).toThrow(/UNIQUE constraint/u)
  })
})
