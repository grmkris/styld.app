import { and, getTableColumns, type InferInsertModel, or, type SQL, sql } from 'drizzle-orm'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Database } from './Db.ts'

/** Every condition at once, for a clause that takes one condition and never none (an upsert's `setWhere`). */
export const allOf = (first: SQL, ...rest: ReadonlyArray<SQL>): SQL => and(first, ...rest) ?? first

/** Any of the conditions, for a clause that takes one condition and never none. */
export const anyOf = (first: SQL, ...rest: ReadonlyArray<SQL>): SQL => or(first, ...rest) ?? first

/** Insert a row only while its parent's claim holds, inside the same batch that ends the claim: the row's values are
 * selected from the parent's row where `claim` holds, so a claim that no longer holds inserts nothing. Column encoders
 * preserve JSON, dates and booleans just as an ordinary Drizzle insert does. */
export const insertWhen = <Table extends AnySQLiteTable>(
  db: Database['Service'],
  table: Table,
  row: InferInsertModel<Table>,
  parent: { readonly table: AnySQLiteTable; readonly claim: SQL | undefined },
) => {
  const fields = new Map(Object.entries(row))
  const selection = Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([key]) => fields.get(key) !== undefined)
      .map(([key, column]) => [key, sql`${sql.param(fields.get(key), column)}`.as(column.name)]),
  )
  // SAFETY: the selection is the row's own columns, keyed as the table keys them -- Drizzle cannot check a selection built from a generic table's columns
  const values = db.select(selection).from(parent.table).where(parent.claim).limit(1) as never
  return db.insert(table).select(values)
}
