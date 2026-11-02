/**
 * Export one person's wardrobe from the first Styld (v1), read-only, into a private folder outside the repository: the
 * pieces' rows from v1's Postgres on Railway (`export.json`) and each piece's main picture from v1's Tigris bucket
 * (`pictures/`). `Import.ts` maps and imports the folder; docs/DEPLOYMENT.md › Rebuild and import is the runbook.
 *
 *   V1_DATABASE_URL=… V1_TIGRIS_ACCESS_KEY_ID=… V1_TIGRIS_SECRET_ACCESS_KEY=… V1_TIGRIS_BUCKET=… \
 *     bun tools/import-v1/Export.ts <email> <private-folder>
 *
 * Credentials come from the environment only and are never printed; `V1_TIGRIS_ENDPOINT` defaults to Tigris'
 * `https://t3.storageapi.dev`. The database is read in a read-only transaction. Prints counts, never names or pictures.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { S3Client, SQL } from 'bun'
import { Schema } from 'effect'
import { pictureFile, type V1Export } from './Mapping.ts'

const [email, folder] = process.argv.slice(2)
if (email === undefined || folder === undefined)
  throw new Error('Usage: bun tools/import-v1/Export.ts <email> <folder>')

const required = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`Set ${name}`)
  return value
}

/** The folder is private: never inside the repository, where it could be committed. */
const target = path.resolve(folder)
const repository = path.resolve(import.meta.dir, '../..')
if (target === repository || target.startsWith(`${repository}${path.sep}`))
  throw new Error('The export folder must be outside the repository')

const Row = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  owner: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  colours: Schema.Array(Schema.String),
  key: Schema.String,
  mime: Schema.String,
})

const database = new SQL(required('V1_DATABASE_URL'))
const rows = Schema.decodeUnknownSync(Schema.Array(Row))(
  await database.begin(async (transaction): Promise<unknown> => {
    await transaction`SET TRANSACTION READ ONLY`
    // A completed piece's main picture, its first category and its colours in their order (v1's wardrobe.db.ts).
    const found: unknown = await transaction`
      SELECT ci.id, ci.name, u.name AS owner,
        (SELECT c.name FROM clothing_item_category cic JOIN category c ON c.id = cic.category_id
          WHERE cic.item_id = ci.id ORDER BY c.name LIMIT 1) AS category,
        COALESCE((SELECT array_agg(co.name ORDER BY cc."order") FROM clothing_item_color cc
          JOIN color co ON co.id = cc.color_id WHERE cc.item_id = ci.id), '{}') AS colours,
        m.storage_key AS key, m.mime_type AS mime
      FROM clothing_item ci
        JOIN "user" u ON u.id = ci.user_id
        JOIN media m ON m.id = ci.primary_media_id
      WHERE lower(u.email) = lower(${email}) AND ci.status = 'completed'
      ORDER BY ci.created_at`
    return found
  }),
)
await database.close()

const tigris = new S3Client({
  accessKeyId: required('V1_TIGRIS_ACCESS_KEY_ID'),
  secretAccessKey: required('V1_TIGRIS_SECRET_ACCESS_KEY'),
  bucket: required('V1_TIGRIS_BUCKET'),
  endpoint: process.env['V1_TIGRIS_ENDPOINT'] ?? 'https://t3.storageapi.dev',
})

await mkdir(path.join(target, 'pictures'), { recursive: true, mode: 0o700 })
for (const row of rows) {
  const bytes = new Uint8Array(await tigris.file(row.key).arrayBuffer())
  await writeFile(path.join(target, pictureFile(row.id)), bytes, { mode: 0o600 })
}

const exported: V1Export = {
  version: 1,
  email: email.trim().toLowerCase(),
  name: rows[0]?.owner ?? null,
  exportedAt: new Date().toISOString(),
  pieces: rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    colours: row.colours,
    picture: pictureFile(row.id),
    mime: row.mime,
  })),
}
await writeFile(path.join(target, 'export.json'), `${JSON.stringify(exported, null, 2)}\n`, { mode: 0o600 })
console.log(`Exported ${rows.length} pieces and their pictures`)
