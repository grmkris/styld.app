import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// D1 runs a migration as one batch with foreign keys enforced: `PRAGMA foreign_keys=OFF` and `defer_foreign_keys` do
// not stop `DROP TABLE` from deleting every row that cascades from the dropped table (reproduced on local D1, 3
// November 2026). Drizzle's table rebuild therefore wipes a parent's children. A migration from 3 November on may drop
// a table only once every table that references it is kept aside as `__keep_<table>`, to be put back; earlier ones are
// history that has been applied.

const migrations = new URL('../../db/migrations/', import.meta.url)
const guardedFrom = '20261103'

const folders = readdirSync(migrations).toSorted()
const statementsOf = (folder: string) =>
  readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

/** The tables whose foreign keys point at `table`, in the schema as it is at this point of the migrations. */
const referencing = (db: DatabaseSync, table: string) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(({ name }) => String(name))
    .filter(
      (name) =>
        name !== table &&
        db
          .prepare(`PRAGMA foreign_key_list("${name}")`)
          .all()
          .some((key) => key['table'] === table),
    )

const exists = (db: DatabaseSync, table: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined

/** The dependents a statement would lose: those of the table it drops that are not kept aside as `__keep_<table>`. */
const unkeptBy = (db: DatabaseSync, statement: string): ReadonlyArray<string> => {
  const dropped = /^DROP TABLE\s+[`"]?([a-z_]+)[`"]?/iu.exec(statement)?.[1]
  if (dropped === undefined || dropped.startsWith('__keep_')) return []
  return referencing(db, dropped)
    .filter((dependent) => !exists(db, `__keep_${dependent}`))
    .map((dependent) => `${dropped} drops ${dependent}`)
}

describe('migrations keep the rows that depend on a table they rebuild', () => {
  test('none relies on switching foreign keys off, which D1 ignores', () => {
    for (const folder of folders.filter((name) => name >= guardedFrom))
      expect({
        folder,
        pragma: /PRAGMA\s+(foreign_keys|legacy_alter_table)\b/iu.test(statementsOf(folder).join('\n')),
      }).toEqual({ folder, pragma: false })
  })

  test('a dropped table’s dependents are kept aside first', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const unkept = folders.flatMap((folder) =>
      statementsOf(folder).flatMap((statement) => {
        const lost = folder >= guardedFrom ? unkeptBy(db, statement).map((loss) => `${folder}: ${loss}`) : []
        db.exec(statement)
        return lost
      }),
    )
    expect(unkept).toEqual([])
  })
})

/** A piece in a look, worn, found in a capture of a gallery photo's garment and matched to it: every kind of link the
 * T-12 rebuild of pieces, detections and photo_garments drops and must put back. */
const linkedRows = [
  `INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac1', 0, 'A', 0);`,
  `INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at) VALUES ('up1','ac1','d','image/png',1,'k','used',0);`,
  `INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at) VALUES ('up2','ac1','e','image/png',1,'k2','used',0);`,
  `INSERT INTO pieces (id, account_id, type, colours, season, occasions, status, source, original_key, content_type, created_at, updated_at) VALUES ('pc1','ac1','coats','["beige"]','cold','[]','ready','website','k','image/png',0,0);`,
  `INSERT INTO pieces (id, account_id, type, colours, season, occasions, status, source, original_key, content_type, created_at, updated_at) VALUES ('pc2','ac1','tops','[]','warm','[]','ready','website','k','image/png',0,0);`,
  `INSERT INTO pieces (id, account_id, type, colours, season, occasions, status, source, original_key, content_type, created_at, updated_at) VALUES ('pc3','ac1','jeans','[]',NULL,'[]','ready','website','k','image/png',0,0);`,
  `INSERT INTO looks (id, account_id, name, created_at) VALUES ('lk1','ac1','L',0);`,
  `INSERT INTO look_pieces (look_id, piece_id, position) VALUES ('lk1','pc1',0);`,
  `INSERT INTO look_pieces (look_id, piece_id, position) VALUES ('lk1','pc2',1);`,
  `INSERT INTO worn_pieces (account_id, day, piece_id, position) VALUES ('ac1','2026-11-03','pc3',0);`,
  `INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, favourite, created_at, updated_at) VALUES ('ph1','ac1','up2','k','image/png','ready',0,0,0);`,
  `INSERT INTO photo_garments (id, photo_id, account_id, position, cutout_key, type, colours, piece_id, state) VALUES ('pg1','ph1','ac1',0,'c','coats','[]','pc1','confirmed');`,
  `INSERT INTO captures (id, account_id, kind, source, status, garment_id, original_key, content_type, bytes, credits, attempt, created_at, updated_at) VALUES ('cp1','ac1','photo','photos','done','pg1','k','image/png',1,0,0,0,0);`,
  `INSERT INTO capture_frames (capture_id, idx, upload_id, object_key, at_ms, sharpness) VALUES ('cp1',0,'up1','f',0,'[]');`,
  `INSERT INTO detections (id, capture_id, account_id, status, source_key, preselected, suggested_colours, suggested_occasions, suggested_season, duplicate_of, created_at) VALUES ('dt1','cp1','ac1','kept','s',1,'[]','[]','cold','pc2',0);`,
  `UPDATE pieces SET detection_id = 'dt1' WHERE id = 'pc1';`,
  // A board holds a piece and a label: dropping pieces deletes only the piece's item, so only it is put back (Eva's
  // boards on the preview, 4 November: putting back every kept item collided with the label that stayed).
  `INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at) VALUES ('bd1','ac1','B','paper',1,'private','[]','b',0,0);`,
  `INSERT INTO board_items (board_id, id, kind, piece_id, x, y, size, turn, z, flipped) VALUES ('bd1','it1','piece','pc1',0,0,1,0,0,0);`,
  `INSERT INTO board_items (board_id, id, kind, text, text_style, x, y, size, turn, z, flipped) VALUES ('bd1','it2','text','Weekend','label',0,0,1,0,1,0);`,
]

describe('the T-12 rebuild of pieces, detections and photo garments', () => {
  test('keeps every row and link, and turns warm and cold into their seasons', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const rebuild = '20261103203624'
    const applied = (folder: string) => {
      for (const statement of statementsOf(folder)) db.exec(statement)
    }
    folders.filter((name) => name < rebuild).forEach(applied)
    for (const row of linkedRows) db.exec(row)
    folders.filter((name) => name >= rebuild).forEach(applied)
    const one = (query: string) => db.prepare(query).get()
    expect(one('SELECT count(*) AS n FROM pieces')).toEqual({ n: 3 })
    expect(one('SELECT count(*) AS n FROM look_pieces')).toEqual({ n: 2 })
    expect(one('SELECT count(*) AS n FROM worn_pieces')).toEqual({ n: 1 })
    expect(one('SELECT count(*) AS n FROM capture_frames')).toEqual({ n: 1 })
    expect(db.prepare("SELECT id, kind, piece_id FROM board_items WHERE board_id = 'bd1' ORDER BY id").all()).toEqual([
      { id: 'it1', kind: 'piece', piece_id: 'pc1' },
      { id: 'it2', kind: 'text', piece_id: null },
    ])
    expect(one("SELECT detection_id AS link FROM pieces WHERE id = 'pc1'")).toEqual({ link: 'dt1' })
    expect(one("SELECT garment_id AS link FROM captures WHERE id = 'cp1'")).toEqual({ link: 'pg1' })
    expect(one("SELECT piece_id AS link FROM photo_garments WHERE id = 'pg1'")).toEqual({ link: 'pc1' })
    expect(one("SELECT duplicate_of AS link FROM detections WHERE id = 'dt1'")).toEqual({ link: 'pc2' })
    expect(db.prepare('SELECT id, seasons, rainproof FROM pieces ORDER BY id').all()).toEqual([
      { id: 'pc1', seasons: '["autumn","winter"]', rainproof: 0 },
      { id: 'pc2', seasons: '["spring","summer"]', rainproof: 0 },
      { id: 'pc3', seasons: '[]', rainproof: 0 },
    ])
    expect(one("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '__keep_%'")).toEqual({ n: 0 })
  })
})
