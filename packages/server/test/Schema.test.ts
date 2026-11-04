import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { localD1 } from './LocalD1.ts'
import { liveShape, readSchema } from './SchemaShape.ts'
import { snapshotShape } from './SchemaSnapshot.ts'

// The migrations, the baseline and each one after it, build exactly the schema the latest snapshot records (the native suite checks the same against
// workerd's D1), and the schema refuses rows the protocol never writes.

const fresh = () => localD1().sqlite

describe('the migrated schema', () => {
  test('is what its snapshot records: tables, columns, foreign keys, indexes and checks', () => {
    const db = fresh()
    const live = Effect.runSync(readSchema((sql) => Effect.sync(() => db.prepare(sql).all())))
    expect(liveShape(live)).toEqual(snapshotShape())
  })

  test('refuses an unknown garment type, a link to nothing, and a list that is not one', () => {
    const db = fresh()
    db.exec("INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0)")
    const piece = (id: string, type: string, colours: string, uploadId: string | null) =>
      db
        .prepare(
          `INSERT INTO pieces (id, account_id, type, colours, seasons, occasions, status, source, upload_id, original_key,
             content_type, created_at, updated_at)
           VALUES (?, 'ac_1', ?, ?, '[]', '[]', 'ready', 'website', ?, 'k', 'image/png', 0, 0)`,
        )
        .run(id, type, colours, uploadId)
    expect(() => piece('pc_1', 'cardigans', '[]', null)).toThrow(/CHECK constraint failed: pieces_type/)
    expect(() => piece('pc_2', 'shortSleeveTops', '"black"', null)).toThrow(/CHECK constraint failed: pieces_colours/)
    expect(() => piece('pc_3', 'shortSleeveTops', '[]', 'up_missing')).toThrow(/FOREIGN KEY constraint failed/)
    // A type added since the baseline (T-12) is accepted.
    piece('pc_5', 'sportShoes', '[]', null)
    piece('pc_4', 'knitwear', '["black"]', null)
    expect(db.prepare('SELECT count(*) AS pieces FROM pieces').get()).toEqual({ pieces: 2 })
  })
})
