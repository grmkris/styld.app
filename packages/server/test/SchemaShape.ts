// The schema's shape, read the same way from a live database (`sqlite_master` and SQLite's pragmas) and from the
// baseline's Drizzle snapshot, so a test compares the two: tables, columns and whether each may be null, foreign keys
// and what deleting their target does, named indexes and CHECK constraints. A UNIQUE column's own index has no
// statement and is not listed; its column is. D1 refuses the pragmas as table functions, so each table's are asked on
// their own.

import { Effect, Schema } from 'effect'

const Table = Schema.Struct({ tableName: Schema.String, sql: Schema.String })
const Column = Schema.Struct({ name: Schema.String, notnull: Schema.Number })
const ForeignKey = Schema.Struct({ from: Schema.String, table: Schema.String, on_delete: Schema.String })
const Index = Schema.Struct({ tableName: Schema.String, name: Schema.String })

/** The live schema, as a database answered for it. */
export const LiveSchema = Schema.Struct({
  tables: Schema.Array(Table),
  columns: Schema.Array(Schema.Struct({ tableName: Schema.String, name: Schema.String, notNull: Schema.Number })),
  foreignKeys: Schema.Array(
    Schema.Struct({ tableName: Schema.String, column: Schema.String, tableTo: Schema.String, onDelete: Schema.String }),
  ),
  indexes: Schema.Array(Index),
})
export type LiveSchema = typeof LiveSchema.Type

/** Not one of the tables D1, Alchemy and SQLite keep for themselves. */
const isOurs = ({ tableName }: { readonly tableName: string }) => !/^(__|_cf_|sqlite_)/u.test(tableName)

const rowsOf = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, rows: ReadonlyArray<unknown>) =>
  Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(Effect.orDie)

/** Read the live schema through `read`, which runs one statement and answers its rows. */
export const readSchema = <E, R>(read: (sql: string) => Effect.Effect<ReadonlyArray<unknown>, E, R>) =>
  Effect.gen(function* () {
    const tables = (yield* rowsOf(
      Table,
      yield* read("SELECT name AS tableName, sql FROM sqlite_master WHERE type = 'table'"),
    )).filter(isOurs)
    const perTable = yield* Effect.forEach(tables, ({ tableName }) =>
      Effect.gen(function* () {
        if (!/^\w+$/u.test(tableName)) return yield* Effect.die(new Error(`Unexpected table name ${tableName}`))
        const columns = yield* rowsOf(Column, yield* read(`PRAGMA table_info("${tableName}")`))
        const foreignKeys = yield* rowsOf(ForeignKey, yield* read(`PRAGMA foreign_key_list("${tableName}")`))
        return {
          columns: columns.map(({ name, notnull }) => ({ tableName, name, notNull: notnull })),
          foreignKeys: foreignKeys.map((key) => ({
            tableName,
            column: key.from,
            tableTo: key.table,
            onDelete: key.on_delete,
          })),
        }
      }),
    )
    const indexes = yield* rowsOf(
      Index,
      yield* read("SELECT name, tbl_name AS tableName FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"),
    )
    return {
      tables,
      columns: perTable.flatMap(({ columns }) => columns),
      foreignKeys: perTable.flatMap(({ foreignKeys }) => foreignKeys),
      indexes: indexes.filter(isOurs),
    } satisfies LiveSchema
  })

/** A schema's shape: sorted lines a failing comparison shows one by one. */
export interface SchemaShape {
  readonly tables: ReadonlyArray<string>
  readonly columns: ReadonlyArray<string>
  readonly foreignKeys: ReadonlyArray<string>
  readonly indexes: ReadonlyArray<string>
  readonly checks: ReadonlyArray<string>
}

const sorted = (lines: ReadonlyArray<string>) => lines.toSorted()

export const column = (table: string, name: string, notNull: boolean) => `${table}.${name}${notNull ? ' not null' : ''}`
export const foreignKey = (table: string, name: string, tableTo: string, onDelete: string) =>
  `${table}.${name} -> ${tableTo} on delete ${onDelete.toLowerCase()}`

/** The shape of a live database. */
export const liveShape = (live: LiveSchema): SchemaShape => {
  const tables = live.tables.filter(isOurs)
  return {
    tables: sorted(tables.map(({ tableName }) => tableName)),
    columns: sorted(live.columns.filter(isOurs).map((row) => column(row.tableName, row.name, row.notNull === 1))),
    foreignKeys: sorted(
      live.foreignKeys.filter(isOurs).map((row) => foreignKey(row.tableName, row.column, row.tableTo, row.onDelete)),
    ),
    indexes: sorted(live.indexes.filter(isOurs).map(({ tableName, name }) => `${tableName}.${name}`)),
    checks: sorted(
      tables.flatMap(({ tableName, sql }) =>
        [...sql.matchAll(/CONSTRAINT "([^"]+)" CHECK/gu)].map(([, name]) => `${tableName}.${String(name)}`),
      ),
    ),
  }
}
