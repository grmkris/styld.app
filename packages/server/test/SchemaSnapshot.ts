import { readdirSync, readFileSync } from 'node:fs'
import { Schema } from 'effect'
import { column, foreignKey, type SchemaShape } from './SchemaShape.ts'

// The baseline migration's Drizzle snapshot as a schema shape (`SchemaShape.ts`), and its SQL, for the tests that
// compare a live database with it.

const migrations = new URL('../../db/migrations/', import.meta.url)

/** The one baseline migration's folder. */
const baseline = () => {
  const folders = readdirSync(migrations)
  if (folders.length !== 1) throw new Error(`Expected one baseline migration, found ${folders.length}`)
  return new URL(`${String(folders[0])}/`, migrations)
}

/** The baseline's statements, in order. */
export const baselineStatements = () =>
  readFileSync(new URL('migration.sql', baseline()), 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => statement.trim().length > 0)

const Entity = Schema.Union([
  Schema.Struct({ entityType: Schema.Literal('tables'), name: Schema.String }),
  Schema.Struct({
    entityType: Schema.Literal('columns'),
    table: Schema.String,
    name: Schema.String,
    notNull: Schema.Boolean,
  }),
  Schema.Struct({
    entityType: Schema.Literal('fks'),
    table: Schema.String,
    columns: Schema.Array(Schema.String),
    tableTo: Schema.String,
    onDelete: Schema.String,
  }),
  Schema.Struct({ entityType: Schema.Literal('indexes'), table: Schema.String, name: Schema.String }),
  Schema.Struct({ entityType: Schema.Literal('checks'), table: Schema.String, name: Schema.String }),
  Schema.Struct({ entityType: Schema.Literals(['pks', 'uniques', 'views']) }),
])
const Snapshot = Schema.Struct({ ddl: Schema.Array(Entity) })

/** The shape the baseline's snapshot says the schema has. */
export const snapshotShape = (): SchemaShape => {
  const { ddl } = Schema.decodeUnknownSync(Snapshot)(
    JSON.parse(readFileSync(new URL('snapshot.json', baseline()), 'utf8')),
  )
  const lines = (pick: (entity: (typeof ddl)[number]) => ReadonlyArray<string>) => ddl.flatMap(pick).toSorted()
  return {
    tables: lines((entity) => (entity.entityType === 'tables' ? [entity.name] : [])),
    columns: lines((entity) =>
      entity.entityType === 'columns' ? [column(entity.table, entity.name, entity.notNull)] : [],
    ),
    foreignKeys: lines((entity) =>
      entity.entityType === 'fks'
        ? entity.columns.map((name) => foreignKey(entity.table, name, entity.tableTo, entity.onDelete))
        : [],
    ),
    indexes: lines((entity) => (entity.entityType === 'indexes' ? [`${entity.table}.${entity.name}`] : [])),
    checks: lines((entity) => (entity.entityType === 'checks' ? [`${entity.table}.${entity.name}`] : [])),
  }
}
