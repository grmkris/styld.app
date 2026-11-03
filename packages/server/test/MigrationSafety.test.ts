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
