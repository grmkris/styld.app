import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'

// Rehearse the forward migration with existing rows and D1's foreign keys still enabled inside its transaction.
// An empty-schema comparison cannot detect children lost by the parent table rebuild.
test('durability migration preserves existing generations and outstanding settlement records', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys = ON')
    const migrations = new URL('../../db/migrations/', import.meta.url)
    const target = '20261102202631_c8_durability'
    for (const folder of readdirSync(migrations)
      .toSorted()
      .filter((name) => name < target))
      db.exec(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'))
    db.exec(`
      INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0);
      INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at) VALUES ('bd_1', 'ac_1', 'Trip', 'paper', 0, 'private', '[]', 'trip', 0, 0);
      INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'tops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0);
      INSERT INTO generation_jobs (id, account_id, board_id, kind, prompt, status, collage_version, moods, created_at, updated_at)
        VALUES ('gj_1', 'ac_1', 'bd_1', 'sticker', 'a lemon', 'drawing', 1, '[]', 10, 20);
      INSERT INTO generation_picks (job_id, position, piece_id) VALUES ('gj_1', 0, 'pc_1');
      INSERT INTO generation_pictures (job_id, prompt, status, image_id, started_at) VALUES ('gj_1', 'a lemon on green', 'drawing', NULL, 21);
      INSERT INTO pending_settlements (hold_id, account_id, ending, updated_at) VALUES ('generation/gj_1/0', 'ac_1', NULL, 20);
    `)
    const tables = ['generation_jobs', 'generation_picks', 'generation_pictures', 'pending_settlements']
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())
    db.exec('BEGIN')
    db.exec(readFileSync(new URL(`${target}/migration.sql`, migrations), 'utf8'))
    db.exec('COMMIT')
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    db.exec("DELETE FROM accounts WHERE id = 'ac_1'")
    expect(db.prepare('SELECT hold_id FROM pending_settlements').all()).toEqual([{ hold_id: 'generation/gj_1/0' }])
  } finally {
    db.close()
  }
})
