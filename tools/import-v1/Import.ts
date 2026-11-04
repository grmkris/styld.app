/**
 * Import one exported v1 wardrobe (`Export.ts`'s private folder) into a deployed stage: map it (`Mapping.ts`), upload
 * the bundle to the media bucket under `imports/<id>/`, start the import as the operator, wait until every piece settled,
 * and write the report (`Report.ts`) beside the export. The account is the one the export's email signs in to, made
 * for it if there is none. Running it again imports nothing twice. docs/DEPLOYMENT.md › Rebuild and import.
 *
 *   STYLD_URL=https://… CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… R2_BUCKET=<the stage's mediaBucket output> \
 *     bun --env-file=.env.preview.local tools/import-v1/Import.ts <private-folder> [--keep-bundle] [--retry-failed]
 *
 * The import is started as the operator, with the stage's `STYLD_OPERATOR_TOKEN` from its private env file (the same
 * value the deploy binds), so no browser session is needed. Credentials come from the environment only and are never
 * printed. The bundle goes through Cloudflare's R2 REST API
 * with the operator's API token (the one that deploys), so no separate S3 key is made; the bucket is the stage's media
 * bucket (EU jurisdiction); `--keep-bundle` leaves the uploaded bundle in it, which is deleted once the import settled otherwise.
 * Prints counts, never names or pictures.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ImportStarted, ImportStatus, type ImportManifest, type ImportPiece } from '@styld/protocol'
import { Match, Schema } from 'effect'
import { mapPiece, V1Export } from './Mapping.ts'
import { reportOf, summaryOf, type ImportReport } from './Report.ts'

const [folder, ...flags] = process.argv.slice(2)
if (folder === undefined)
  throw new Error('Usage: bun tools/import-v1/Import.ts <folder> [--keep-bundle] [--retry-failed]')

const required = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`Set ${name}`)
  return value
}

const origin = new URL(required('STYLD_URL')).origin
const operatorToken = required('STYLD_OPERATOR_TOKEN')
/** The stage's media bucket through the R2 REST API: write and delete one object. */
const objects = `https://api.cloudflare.com/client/v4/accounts/${required('CLOUDFLARE_ACCOUNT_ID')}/r2/buckets/${required('R2_BUCKET')}/objects`
const r2 = { authorization: `Bearer ${required('CLOUDFLARE_API_TOKEN')}`, 'cf-r2-jurisdiction': 'eu' }
const objectCall = async (method: 'PUT' | 'DELETE', key: string, init: { body?: BodyInit; type?: string } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${objects}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method,
      headers: { ...r2, ...(init.type === undefined ? {} : { 'content-type': init.type }) },
      ...(init.body === undefined ? {} : { body: init.body }),
    })
    if (response.ok) return
    // The API paces bursts; a few waits get past it.
    if (response.status !== 429 || attempt >= 8) throw new Error(`R2 ${method} answered ${response.status}`)
    await Bun.sleep(1000 * 2 ** Math.min(attempt, 5))
  }
}
const bucket = {
  write: (key: string, body: Uint8Array | string, options: { readonly type: string }) =>
    objectCall('PUT', key, { body: typeof body === 'string' ? body : Uint8Array.from(body), type: options.type }),
  delete: (key: string) => objectCall('DELETE', key),
}

const exported = Schema.decodeUnknownSync(Schema.fromJsonString(V1Export))(
  await readFile(path.join(folder, 'export.json'), 'utf8'),
)

// Map every piece; the refused ones go in the report.
const mapped: Array<{ readonly piece: ImportPiece; readonly bytes: Uint8Array }> = []
const refusals: Array<ImportReport['refusals'][number]> = []
for (const piece of exported.pieces) {
  const bytes = new Uint8Array(await readFile(path.join(folder, piece.picture)))
  Match.valueTags(mapPiece(piece, bytes), {
    Refused: ({ v1Id, reason }) => refusals.push({ v1Id, reason }),
    Mapped: (result) => mapped.push({ piece: result.piece, bytes }),
  })
}

// One bundle per export. A normal retry reuses its start receipt; --retry-failed deliberately starts another run.
const digest = new Bun.CryptoHasher('sha256').update(`${exported.email}\n${exported.exportedAt}`).digest('hex')
const importId = `v1-${digest.slice(0, 24)}`
const manifest: ImportManifest = {
  version: 1,
  email: exported.email,
  displayName: (exported.name ?? exported.email.split('@')[0] ?? 'Styld').trim().slice(0, 64) || 'Styld',
  pieces: mapped.map(({ piece }) => piece),
}
const prefix = `imports/${importId}/`
for (const { piece, bytes } of mapped)
  await bucket.write(`${prefix}${piece.picture}`, bytes, { type: piece.contentType })
await bucket.write(`${prefix}manifest.json`, JSON.stringify(manifest), { type: 'application/json' })
console.log(`Uploaded bundle ${importId}: ${mapped.length} pieces, ${refusals.length} refused`)

/** A request as the operator, through the public edge. */
const asOperator = async (method: 'GET' | 'POST', body?: unknown) => {
  const response = await fetch(`${origin}/api/operator/imports/${importId}`, {
    method,
    headers: { origin, authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok)
    throw new Error(`The import answered ${response.status}: is STYLD_OPERATOR_TOKEN the stage's operator token?`)
  return response.json()
}

const started = Schema.decodeUnknownSync(ImportStarted)(
  await asOperator('POST', {
    operationId: flags.includes('--retry-failed') ? `retry-${crypto.randomUUID()}` : `start-${importId}`,
  }),
)
console.log(`Started into ${started.accountCreated ? 'a new account' : 'an existing account'}`)

/** How long an import may take: Cloudflare Images keeps it to a few pieces a minute at most. */
const patience = 3 * 60 * 60 * 1000
const startedAt = Date.now()
let status = Schema.decodeUnknownSync(ImportStatus)(await asOperator('GET'))
const unsettled = (current: ImportStatus) =>
  current.pieces.filter(({ status: now }) => now === 'waiting' || now === 'processing').length
while (unsettled(status) > 0 && Date.now() - startedAt < patience) {
  console.log(`${status.pieces.length - unsettled(status)} of ${status.pieces.length} settled`)
  await Bun.sleep(15_000)
  status = Schema.decodeUnknownSync(ImportStatus)(await asOperator('GET'))
}

const report = reportOf(exported.pieces.length, refusals, started, status)
const reportPath = path.join(folder, `report-${importId}.json`)
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
console.log(summaryOf(report))
console.log(`Report: ${reportPath}`)

if (!flags.includes('--keep-bundle') && unsettled(status) === 0) {
  for (const { piece } of mapped) await bucket.delete(`${prefix}${piece.picture}`)
  await bucket.delete(`${prefix}manifest.json`)
  console.log('Deleted the bundle from the bucket')
}
