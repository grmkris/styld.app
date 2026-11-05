import { authMirror } from '@styld/db'
import { type AnyColumn, getTableColumns, getTableName, type Table } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { authTables } from '../src/storage.ts'

// The mirrors in `@styld/db` name Yielded's managed tables column for column; when Yielded changes a table, this fails
// before a typed read or delete can name a column that is not there.

const shape = (table: Table) => ({
  name: getTableName(table),
  columns: Object.entries(getTableColumns(table)).map(([key, column]: [string, AnyColumn]) => ({
    key,
    name: column.name,
    type: column.getSQLType(),
    columnType: column.columnType,
    notNull: column.notNull,
  })),
})

const yielded = new Map<string, Table>(Object.entries(authTables))

describe('the typed mirrors of Yielded Auth tables', () => {
  test.each(Object.entries(authMirror))('%s matches Yielded column for column', (key, mirror) => {
    const table = yielded.get(key)
    expect(table === undefined ? undefined : shape(table)).toEqual(shape(mirror))
  })
})
