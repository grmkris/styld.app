import { sql } from 'drizzle-orm'
import { check, type SQLiteColumn } from 'drizzle-orm/sqlite-core'

// The baseline's constraints on text columns: an enum's values (from `@styld/protocol` where the contract names them),
// and the JSON-in-text lists. A null passes a CHECK in SQLite, so a nullable column's constraint holds its values only.

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`

/** The column holds one of `values`. */
export const oneOf = (name: string, column: SQLiteColumn, values: ReadonlyArray<string>) =>
  check(name, sql`${column} IN (${sql.raw(values.map(quoted).join(', '))})`)

/** The column holds a JSON array. */
export const jsonArray = (name: string, column: SQLiteColumn) => check(name, sql`json_type(${column}) = 'array'`)
