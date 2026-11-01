import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { Schema } from 'effect'

const Chunk = Schema.Struct({
  file: Schema.String,
  isEntry: Schema.optional(Schema.Boolean),
  imports: Schema.optional(Schema.Array(Schema.String)),
  css: Schema.optional(Schema.Array(Schema.String)),
})
const Manifest = Schema.Record(Schema.String, Chunk)
const client = 'apps/web/dist/client'
const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
  await readFile('apps/web/dist/client/.vite/manifest.json', 'utf8'),
)
const gzipOf = async (file: string) => gzipSync(await readFile(`${client}/${file}`)).byteLength

// Initial assets: the entry chunk, everything it imports statically, and their stylesheets.
// Dynamic imports (such as the telemetry SDK's never-enabled replay recorder) load on demand.
const initial = new Set<string>()
const visit = (key: string) => {
  const chunk = manifest[key]
  if (chunk === undefined || initial.has(chunk.file)) return
  initial.add(chunk.file)
  for (const css of chunk.css ?? []) initial.add(css)
  for (const imported of chunk.imports ?? []) visit(imported)
}
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry === true)
if (entries.length === 0) throw new Error('No browser entry in the client manifest; build before checking budgets')
for (const [key] of entries) visit(key)
const all = new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]))

let initialGzip = 0
for (const file of initial) initialGzip += await gzipOf(file)
// Every page loads one language's messages before it hydrates; count the largest one.
const catalogs = Object.entries(manifest).filter(([key]) => /packages\/i18n\/src\/catalog-[a-z]+\.ts$/.test(key))
if (catalogs.length === 0) throw new Error('No language catalog chunk in the client manifest')
initialGzip += Math.max(...(await Promise.all(catalogs.map(([, chunk]) => gzipOf(chunk.file)))))
let totalGzip = 0
for (const file of all) totalGzip += await gzipOf(file)
const server = await readFile('apps/web/dist/server/fetch.js')
// Raised from 256 and 512 KiB by the owner on 2026-10-30 for Gallery 2 and boards (docs/STATUS.md › Overnight run),
// and the initial budget once more, to 360 KiB, for boards, profiles and social, because Foldkit ships every page in
// the first load (owner, 2026-10-30; docs/STATUS.md › Plan: boards, profiles and social). Ratcheted on 2026-11-01 (C6)
// to the measured 347,259 bytes plus 3%, once the telemetry SDK loaded only after consent.
if (initialGzip > 357677) throw new Error(`Initial browser assets exceed the 357,677-byte gzip budget: ${initialGzip}`)
if (totalGzip > 716800) throw new Error(`All browser assets exceed the 700 KiB gzip budget: ${totalGzip}`)
if (server.byteLength > 3145728) throw new Error(`SSR Worker exceeds the 3 MiB source budget: ${server.byteLength}`)
console.log(
  `Bundle budgets: initial browser ${initialGzip} gzip bytes; all browser ${totalGzip}; SSR ${server.byteLength} source bytes`,
)
