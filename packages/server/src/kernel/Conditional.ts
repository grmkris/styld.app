import { getTableColumns, type InferInsertModel, type SQL, sql } from 'drizzle-orm'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Database } from './Db.ts'

/** Insert a row only while its parent's claim holds, inside the same batch that ends the claim. Column encoders
 * preserve JSON, dates and booleans just as an ordinary Drizzle insert does. */
export const insertWhen = <Table extends AnySQLiteTable>(
  db: Database['Service'],
  table: Table,
  row: InferInsertModel<Table>,
  condition: SQL,
) => {
  const fields = new Map(Object.entries(row))
  const entries = Object.entries(getTableColumns(table)).filter(([key]) => fields.get(key) !== undefined)
  const names = entries.map(([, column]) => sql.identifier(column.name))
  const values = entries.map(([key, column]) => sql`${sql.param(fields.get(key), column)}`)
  return db.run(
    sql`insert into ${table} (${sql.join(names, sql`, `)}) select ${sql.join(values, sql`, `)} where ${condition}`,
  )
}
