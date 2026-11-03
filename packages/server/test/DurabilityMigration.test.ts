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

// D1 ignores PRAGMA foreign_keys=OFF inside a migration batch. A parent-table rebuild therefore cascades away every
// piece child row. The rotation migration must stay an in-place ALTER so existing wardrobes survive deployment.
test('piece rotation migration preserves all piece-owned rows with foreign keys enabled', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys = ON')
    const migrations = new URL('../../db/migrations/', import.meta.url)
    const target = '20261103182342_piece_rotation'
    for (const folder of readdirSync(migrations)
      .toSorted()
      .filter((name) => name < target))
      db.exec(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'))
    db.exec(`
      INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0);
      INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at)
        VALUES ('bd_1', 'ac_1', 'Trip', 'paper', 0, 'private', '[]', 'trip', 0, 0);
      INSERT INTO looks (id, account_id, name, created_at) VALUES ('lk_1', 'ac_1', 'Trip', 0);
      INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'tops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0);
      INSERT INTO look_pieces (look_id, piece_id, position) VALUES ('lk_1', 'pc_1', 0);
      INSERT INTO board_pins (id, board_id, kind, piece_id, created_at) VALUES ('pn_1', 'bd_1', 'piece', 'pc_1', 0);
      INSERT INTO board_items (board_id, id, kind, piece_id, x, y, size, turn, z, flipped)
        VALUES ('bd_1', 'bi_1', 'piece', 'pc_1', 1, 1, 100, 0, 1, 0);
      INSERT INTO worn_pieces (account_id, day, piece_id, position) VALUES ('ac_1', '2026-11-03', 'pc_1', 0);
      INSERT INTO piece_pictures (piece_id, account_id, state, shown, version, redraws, paid, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'ready', 'clean', 1, 0, 0, 0, 0);
      INSERT INTO piece_turns (piece_id, account_id, state, attempt, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'requested', 1, 0, 0);
    `)
    db.exec(readFileSync(new URL(`${target}/migration.sql`, migrations), 'utf8'))
    expect(db.prepare('SELECT rotation FROM pieces WHERE id = ?').get('pc_1')).toEqual({ rotation: 0 })
    for (const table of ['look_pieces', 'board_pins', 'board_items', 'worn_pieces', 'piece_pictures', 'piece_turns'])
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 1 })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    db.close()
  }
})
