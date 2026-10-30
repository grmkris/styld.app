import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'

const folder = new URL('../migrations/', import.meta.url)
const migrations = readdirSync(folder).toSorted()

/** Apply the migrations from index `from` up to, but not including, `until`. */
const migrate = (database: DatabaseSync, from: number, until: number) => {
  for (const name of migrations.slice(from, until)) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, folder), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) database.exec(statement)
  }
}

const pinsAt = migrations.findIndex((name) => name.endsWith('_board_pins'))

const seeded = () => {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  migrate(database, 0, pinsAt)
  database.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_one', 'r1', 'One', 0);
    INSERT INTO pieces (id, account_id, category, colours, status, source, original_key, content_type, bytes, created_at, updated_at)
      VALUES ('pc_knit', 'ac_one', 'top', '[]', 'ready', 'website', 'k', 'image/webp', 1, 0, 0),
             ('pc_shoe', 'ac_one', 'shoes', '[]', 'ready', 'website', 's', 'image/webp', 1, 0, 0);
    INSERT INTO boards (id, account_id, name, paper, version, created_at, updated_at)
      VALUES ('bd_one', 'ac_one', 'Autumn', 'paper', 3, 1000, 1000);
    INSERT INTO board_images (id, account_id, board_id, object_key, content_type, created_at)
      VALUES ('bm_${'p'.repeat(22)}', 'ac_one', 'bd_one', 'pic', 'image/webp', 2000),
             ('bm_${'q'.repeat(22)}', 'ac_one', 'bd_one', 'old', 'image/webp', 2500);
    INSERT INTO board_items (board_id, id, kind, piece_id, image_id, text, text_style, x, y, size, turn, z, flipped)
      VALUES ('bd_one', 'bi_${'b'.repeat(22)}', 'piece', 'pc_knit', NULL, NULL, NULL, 1, 1, 400, 0, 4, 0),
             ('bd_one', 'bi_${'a'.repeat(22)}', 'piece', 'pc_knit', NULL, NULL, NULL, 2, 2, 400, 0, 2, 0),
             ('bd_one', 'bi_${'c'.repeat(22)}', 'piece', 'pc_shoe', NULL, NULL, NULL, 3, 3, 400, 0, 1, 0),
             ('bd_one', 'bi_${'d'.repeat(22)}', 'text', NULL, NULL, 'Rain', 'label', 4, 4, 300, 0, 3, 0),
             ('bd_one', 'bi_${'e'.repeat(22)}', 'image', NULL, 'bm_${'p'.repeat(22)}', NULL, NULL, 5, 5, 400, 0, 5, 0);
  `)
  migrate(database, pinsAt, migrations.length)
  return database
}

describe('pinning what boards already hold', () => {
  test('each piece on a table becomes one pin, and every picture of the board one more', () => {
    const pins = seeded()
      .prepare(
        'SELECT id, kind, piece_id AS pieceId, image_id AS imageId, created_at AS at FROM board_pins ORDER BY at',
      )
      .all()
    expect(pins).toEqual([
      { id: `pn_${'c'.repeat(22)}`, kind: 'piece', pieceId: 'pc_shoe', imageId: null, at: 1001 },
      { id: `pn_${'a'.repeat(22)}`, kind: 'piece', pieceId: 'pc_knit', imageId: null, at: 1002 },
      { id: `pn_${'p'.repeat(22)}`, kind: 'picture', pieceId: null, imageId: `bm_${'p'.repeat(22)}`, at: 2000 },
      { id: `pn_${'q'.repeat(22)}`, kind: 'picture', pieceId: null, imageId: `bm_${'q'.repeat(22)}`, at: 2500 },
    ])
  })

  test('the table itself is left as it was', () => {
    const database = seeded()
    expect(database.prepare('SELECT count(*) AS items FROM board_items').get()).toEqual({ items: 5 })
    expect(database.prepare('SELECT version FROM boards').get()).toEqual({ version: 3 })
  })

  test('deleting a piece unpins it from its boards', () => {
    const database = seeded()
    database.exec("DELETE FROM pieces WHERE id = 'pc_knit'")
    expect(database.prepare("SELECT count(*) AS pins FROM board_pins WHERE kind = 'piece'").get()).toEqual({ pins: 1 })
  })
})
