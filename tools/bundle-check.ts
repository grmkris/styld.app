/**
 * The size budgets in tools/budgets.json, read from the build `bun run build` writes to `apps/web/dist` (`bun run check`
 * runs the build, then this, then the tests; the native suite serves the same build), and from the API and edge Workers
 * bundled here as Alchemy bundles them at deploy. A raise is its own commit whose message gives the measured cause
 * (AGENTS.md › Commands); git log keeps the history of every number.
 */
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { WorkerBundle, type WorkerBundleOptions } from '@alchemy.run/cloudflare/Workers/Sources/Rolldown'
import { NodeServices } from '@effect/platform-node'
import { Effect, Schema } from 'effect'

const Budget = Schema.Struct({ bytes: Schema.Number, why: Schema.String })
const Budgets = Schema.Struct({
  browserInitialGzip: Budget,
  browserAllGzip: Budget,
  ssrSource: Budget,
  apiWorkerStartup: Budget,
  edgeWorker: Budget,
})
const budgets = Schema.decodeUnknownSync(Schema.fromJsonString(Budgets))(await readFile('tools/budgets.json', 'utf8'))

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

/**
 * A Worker's minified startup code: its entry chunk and every chunk it imports statically, as Alchemy's `WorkerBundle`
 * builds them (rolldown, minified, `strictExecutionOrder`). Workerd evaluates all of it before the first event, under
 * Cloudflare's startup CPU limit (docs/archive/STATUS-2026-11-05.md › The API Worker's startup); chunks behind a dynamic
 * `import()` load on first use and are not counted.
 */
const workerStartup = (main: string, entry: WorkerBundleOptions['entry']) =>
  Effect.gen(function* () {
    const bundler = yield* WorkerBundle
    const { files } = yield* bundler.build({
      id: main,
      main,
      // Both Workers deploy on this date; Alchemy adds new_module_registry and no nodejs_compat after 2026-08-04.
      compatibility: { date: '2026-10-19', flags: ['new_module_registry'] },
      entry,
      stack: { name: 'StyldAppV2', stage: 'budget' },
      extraOptions: undefined,
    })
    const text = new Map(
      files.map((file) => [
        file.path,
        typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content),
      ]),
    )
    const eager = new Set<string>()
    const follow = (path: string) => {
      const code = text.get(path)
      if (code === undefined || eager.has(path)) return
      eager.add(path)
      for (const [, imported] of code.matchAll(/(?:import|export)\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+)["']/g))
        if (imported !== undefined) follow(imported)
    }
    follow(files[0].path)
    const encoder = new TextEncoder()
    const sizeOf = (path: string) => encoder.encode(text.get(path) ?? '').byteLength
    let bytes = 0
    for (const path of eager) bytes += sizeOf(path)
    return { entry: sizeOf(files[0].path), bytes }
  })
const [api, edge] = await Effect.runPromise(
  Effect.all([
    workerStartup('packages/server/src/StyldWorker.ts', { kind: 'effect', exports: {} }),
    workerStartup('packages/server/src/EdgeWorker.ts', { kind: 'external' }),
  ]).pipe(Effect.provide(NodeServices.layer)),
)

const measured: ReadonlyArray<readonly [string, number, typeof Budget.Type]> = [
  ['browserInitialGzip', initialGzip, budgets.browserInitialGzip],
  ['browserAllGzip', totalGzip, budgets.browserAllGzip],
  ['ssrSource', server.byteLength, budgets.ssrSource],
  ['apiWorkerStartup', api.bytes, budgets.apiWorkerStartup],
  ['edgeWorker', edge.bytes, budgets.edgeWorker],
]
const over = measured.flatMap(([name, bytes, budget]) =>
  bytes > budget.bytes ? [`${name}: ${bytes} bytes over its ${budget.bytes}-byte budget`] : [],
)
console.log(
  `Bundle budgets: initial browser ${initialGzip} gzip bytes; all browser ${totalGzip}; SSR ${server.byteLength} ` +
    `source bytes; API Worker startup ${api.bytes} (entry ${api.entry}); edge Worker ${edge.bytes}`,
)
if (over.length > 0) throw new Error(`Bundle budgets exceeded (tools/budgets.json):\n${over.join('\n')}`)
