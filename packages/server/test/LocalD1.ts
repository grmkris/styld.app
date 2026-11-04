import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1Database } from '@cloudflare/workers-types'
import { Predicate } from 'effect'
import { migrationStatements } from './SchemaSnapshot.ts'

// A D1 database for unit tests: SQLite in memory with every migration applied and foreign keys enforced, as D1
// enforces them, behind the slice of D1's API that drizzle and the stores call (prepare, bind, all, raw, first, run,
// batch). Real SQL semantics, no Worker; the native suite is still what proves workerd's D1.

const value = (input: unknown): SQLInputValue => {
  if (Predicate.isBoolean(input)) return input ? 1 : 0
  if (input === undefined || input === null) return null
  if (Predicate.isString(input) || Predicate.isNumber(input) || Predicate.isBigInt(input)) return input
  if (input instanceof Uint8Array) return input
  throw new Error(`A D1 binding SQLite cannot take: ${typeof input}`)
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: ReadonlyArray<unknown> = [],
  ) {}
  bind(...params: ReadonlyArray<unknown>) {
    return new Statement(this.db, this.sql, params)
  }
  private prepared() {
    return this.db.prepare(this.sql)
  }
  private returns() {
    return /^\s*(select|with)\b/i.test(this.sql) || /\breturning\b/i.test(this.sql)
  }
  async all() {
    if (!this.returns()) return { results: [], meta: this.execute() }
    return { results: this.prepared().all(...this.params.map(value)), meta: { changes: 0 } }
  }
  async raw() {
    const statement = this.prepared()
    statement.setReturnArrays(true)
    return statement.all(...this.params.map(value))
  }
  async first() {
    return this.prepared().get(...this.params.map(value)) ?? null
  }
  async run() {
    if (this.returns()) return { results: this.prepared().all(...this.params.map(value)), meta: { changes: 0 } }
    return { results: [], meta: this.execute() }
  }
  execute() {
    const result = this.prepared().run(...this.params.map(value))
    return { changes: Number(result.changes) }
  }
}

/** A fresh database with the schema the migrations make. */
export const localD1 = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const statement of migrationStatements()) db.exec(statement)
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: ReadonlyArray<Statement>) => {
      db.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  // SAFETY: the shim implements the D1 calls drizzle and the stores make -- the rest of D1Database (exec, sessions, dump) is never called by them
  return Object.assign<D1Database, { readonly sqlite: DatabaseSync }>(d1 as never, { sqlite: db })
}

/** A local D1 with one member, `ac_1`: a lifetime membership, so each day brings the members' allowance and the
 * account's 3 free credits are on top. */
export const memberD1 = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  database.sqlite.exec(
    "INSERT INTO memberships (account_id, plan, until, status, updated_at) VALUES ('ac_1', 'lifetime', NULL, 'active', 0)",
  )
  return database
}
