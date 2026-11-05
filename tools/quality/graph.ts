import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, posix } from 'node:path'
import { Schema } from 'effect'
import { importsOf, sourceFiles, valueImportsOf } from './source.ts'

const Manifest = Schema.Struct({
  name: Schema.String,
  exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
type Workspace = { readonly directory: string; readonly manifest: typeof Manifest.Type }

const directions: Readonly<Record<string, readonly string[]>> = {
  '@styld/web': ['@styld/auth', '@styld/i18n', '@styld/imaging', '@styld/observability', '@styld/protocol'],
  '@styld/server': [
    '@styld/auth',
    '@styld/db',
    '@styld/domain',
    '@styld/i18n',
    '@styld/imaging',
    '@styld/observability',
    '@styld/protocol',
  ],
  // Auth writes the code email, in the person's language.
  '@styld/auth': ['@styld/db', '@styld/i18n'],
  // Browser-safe contracts: the typed API and the schemas assistants and the website share.
  '@styld/protocol': ['@styld/auth', '@styld/i18n'],
  '@styld/domain': [],
  // The schema's CHECKs are the contract's own literals.
  '@styld/db': ['@styld/protocol'],
  '@styld/i18n': [],
  // Pure pixel work, the same in the Worker and the browser: keying a drawn picture, shrinking, flattening.
  '@styld/imaging': [],
  '@styld/observability': [],
}

const packageName = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/')

export const checkDirection = (from: string, to: string) => {
  if (from !== to && !directions[from]?.includes(to)) throw new Error(`Forbidden dependency: ${from} -> ${to}`)
}

export const assertBrowserSafe = (file: string, specifier: string) => {
  if (
    isBuiltin(specifier) ||
    /^(node:|bun:|cloudflare:|@alchemy\.run\/cloudflare|@yielded\/auth-persistence|@effect\/sql-|drizzle-orm)/.test(
      specifier,
    ) ||
    /^packages\/(server|db)\//.test(file) ||
    /\/server\//.test(file) ||
    (file.startsWith('packages/auth/src/') &&
      !/^packages\/auth\/src\/(client|config|EmailEntryContract)\.ts$/.test(file))
  ) {
    throw new Error(`Server adapter in browser graph: ${file} -> ${specifier}`)
  }
}

const resolveWorkspace = (target: Workspace, specifier: string) => {
  const subpath = specifier === target.manifest.name ? '.' : `.${specifier.slice(target.manifest.name.length)}`
  for (const [key, value] of Object.entries(target.manifest.exports ?? {})) {
    if (key === subpath) return posix.join(target.directory, value)
    if (key.endsWith('*') && subpath.startsWith(key.slice(0, -1)))
      return posix.join(target.directory, value.replace('*', subpath.slice(key.length - 1)))
  }
  throw new Error(`Unexported workspace import: ${specifier}`)
}

const resolveEdge = (
  file: string,
  specifier: string,
  owner: Workspace | undefined,
  workspaces: ReadonlyMap<string, Workspace>,
) => {
  const target = workspaces.get(packageName(specifier))
  if (target !== undefined) {
    if (owner !== undefined) {
      checkDirection(owner.manifest.name, target.manifest.name)
      if (owner !== target && owner.manifest.dependencies?.[target.manifest.name] !== 'workspace:*')
        throw new Error(`Undeclared workspace dependency in ${file}: ${specifier}`)
    }
    return resolveWorkspace(target, specifier)
  }
  if (specifier.startsWith('@styld/')) throw new Error(`Unknown workspace import in ${file}: ${specifier}`)
  if (!specifier.startsWith('.')) return undefined
  const destination = posix.normalize(posix.join(dirname(file), specifier))
  if (owner !== undefined && !destination.startsWith(`${owner.directory}/`))
    throw new Error(`Cross-package relative import: ${file} -> ${specifier}`)
  if (file.includes('/src/') && /\/test\//.test(destination)) throw new Error(`Test fixture imported by ${file}`)
  return destination
}

// Local source imports must resolve to audited files. Otherwise an extensionless
// barrel or a JavaScript bridge could hide a server adapter from traversal.
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const sourceSubstitutions: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}
const resolveSource = (target: string, files: ReadonlySet<string>) => {
  if (files.has(target)) return target
  const extension = posix.extname(target)
  if (extension !== '' && !sourceExtensions.includes(extension)) {
    if (target.includes('?') || target.includes('#')) throw new Error(`Unsupported source import: ${target}`)
    return undefined
  }
  const candidates =
    extension === ''
      ? sourceExtensions.flatMap((suffix) => [`${target}${suffix}`, `${target}/index${suffix}`])
      : (sourceSubstitutions[extension] ?? []).map((suffix) => `${target.slice(0, -extension.length)}${suffix}`)
  const matches = candidates.filter((candidate) => files.has(candidate))
  if (matches.length > 1) throw new Error(`Ambiguous source import: ${target}; use an explicit source extension`)
  const resolved = matches[0]
  if (resolved === undefined) throw new Error(`Unresolved source import: ${target}`)
  return resolved
}

export const checkGraph = async (root = '.') => {
  const files = await sourceFiles(root)
  const fileSet = new Set(files)
  const workspaces: Workspace[] = []
  const dirs = new Set(
    files.filter((file) => /^(apps|packages)\//.test(file)).map((file) => file.split('/').slice(0, 2).join('/')),
  )
  for (const directory of dirs)
    workspaces.push({
      directory,
      manifest: Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
        await readFile(posix.join(root, directory, 'package.json'), 'utf8'),
      ),
    })
  const byName = new Map(workspaces.map((workspace) => [workspace.manifest.name, workspace]))
  const edges = new Map<string, string[]>()
  const imports = new Map<string, string[]>()
  for (const file of files) {
    const owner = workspaces.find(({ directory }) => file.startsWith(`${directory}/`))
    const requests = importsOf(file, await readFile(posix.join(root, file), 'utf8'))
    imports.set(file, requests)
    edges.set(
      file,
      requests.flatMap((specifier) => {
        const target = resolveEdge(file, specifier, owner, byName)
        const source = target === undefined ? undefined : resolveSource(target, fileSet)
        return source === undefined ? [] : [source]
      }),
    )
  }
  const visited = new Set<string>()
  const visitBrowser = (file: string) => {
    if (visited.has(file)) return
    visited.add(file)
    const requests = imports.get(file)
    if (requests === undefined) throw new Error(`Unresolved browser source ${file}`)
    assertBrowserSafe(file, '')
    for (const specifier of requests) assertBrowserSafe(file, specifier)
    for (const target of edges.get(file) ?? []) visitBrowser(target)
  }
  visitBrowser('apps/web/src/entry.ts')
  // The assistant views are a second browser program, served to ChatGPT and Claude.
  if (fileSet.has('apps/web/src/assistant/entry.ts')) visitBrowser('apps/web/src/assistant/entry.ts')
  return { files: files.length, browserModules: visited.size }
}

// Inside the API Worker (`packages/server/src`), by what a file needs when it runs (value imports; a type-only import
// leaves nothing in the program). An area is a folder (`wardrobe/`) or a file at the top (`Config.ts`).
// - The bottom (`kernel/`, `jobs/`, and the facts they read: `Resources.ts`, `Streams.ts`) imports nothing above it.
// - The provider seam (`ai/` and the call, error, cost, HTTP, Clef and text transport files of `providers/`) is an area of
//   its own, and imports only the bottom and itself: every module may use it, so it may use none of them. The rest of
//   `providers/` are adapters: they implement the ports domain modules declare (`capture/Providers.ts`), so they may
//   import those modules, and a module reaching an adapter is a cycle.
// - The surfaces are `tools/` (the assistants' tools and views), `mcp/` (their MCP transport) and `stylist/` (Styld's
//   chat). Domain modules (every other folder) never import a surface, and `tools/` and `stylist/` never import `mcp/`.
// - Two areas never import each other, except the pairs below: each one is a cycle the code has today, kept until it is
//   broken. The list can only shrink: a pair that is no longer a cycle fails the check until it is taken off.

const serverRoot = 'packages/server/src/'

/** The cycles between areas the code has today, each with why it is still there. */
export const allowedCycles: ReadonlyArray<readonly [string, string, string]> = [
  [
    'Config.ts',
    'Operator.ts',
    "Config decodes the operator token with Operator's digest; Operator reads the Deployment",
  ],
  [
    'Config.ts',
    'billing/',
    "Config decodes Dodo's webhook secret with billing's key reader; billing reads the Deployment",
  ],
  [
    'billing/',
    'usage/',
    "Holds take the day's allowance from the membership (allowanceAt); billing settles through Holds",
  ],
  ['boards/', 'social/', 'boards read profiles, visibility and translations; social composes boards and pages them'],
  ['capture/', 'photos/', "the capture store writes a photo garment's offer in its own batch (photos/Rows.ts)"],
  ['capture/', 'wardrobe/', "captures write pieces; the wardrobe's store and module use capture's rows and cut-out"],
  ['looks/', 'social/', 'sharing a look needs a published profile (ProfileStore); social composes looks'],
  ['safety/', 'social/', 'checks read visibility and profiles; every public read applies the checks'],
  [
    'safety/',
    'wardrobe/',
    "the judge reads pieces' pictures (Delivery); the wardrobe marks changed pieces for a check",
  ],
  ['social/', 'taste/', "taste reads Show me (ShowMe.ts); What's new orders by taste and the module composes it"],
  ['social/', 'wardrobe/', "public pages show pieces' pictures; the wardrobe module is built over social's layer"],
]

const bottom = new Set(['kernel/', 'jobs/', 'Resources.ts', 'Streams.ts'])
const seam = (file: string) =>
  file.startsWith('ai/') || /^providers\/(Call|ClefCall|Errors|Costs|Http|Text)\.ts$/.test(file)
const surfaces = new Set(['tools/', 'mcp/', 'stylist/'])

/** The provider seam's area. */
const seamArea = 'providers/ (seam)'

/** A server file's area: the provider seam, its folder, or the file itself at the top. */
export const areaOf = (file: string) => {
  if (seam(file)) return seamArea
  const slash = file.indexOf('/')
  return slash < 0 ? file : file.slice(0, slash + 1)
}

const pairName = (a: string, b: string) => (a < b ? `${a} <-> ${b}` : `${b} <-> ${a}`)

/** A domain module: any folder that is not the bottom, the provider seam's or a surface. */
const isDomain = (file: string) => {
  const area = areaOf(file)
  return area.endsWith('/') && !bottom.has(area) && !surfaces.has(area) && area !== 'providers/'
}

/** Each rule on one import between two areas: what it breaks, when it does. */
const edgeRules: ReadonlyArray<{ readonly breaks: (file: string, target: string) => boolean; readonly why: string }> = [
  {
    breaks: (file, target) => bottom.has(areaOf(file)) && !bottom.has(areaOf(target)),
    why: 'the bottom imports nothing above it',
  },
  {
    breaks: (file, target) => seam(file) && !bottom.has(areaOf(target)),
    why: 'the provider seam imports only the bottom and itself',
  },
  {
    breaks: (file, target) => isDomain(file) && surfaces.has(areaOf(target)),
    why: 'a domain module never imports a surface',
  },
  {
    breaks: (file, target) => ['tools/', 'stylist/'].includes(areaOf(file)) && areaOf(target) === 'mcp/',
    why: 'only the MCP transport is in mcp/',
  },
]

/** The areas each area imports. */
const areasImported = (imports: ReadonlyMap<string, ReadonlyArray<string>>) => {
  const between = new Map<string, Set<string>>()
  for (const [file, targets] of imports)
    for (const target of targets)
      between.set(areaOf(file), (between.get(areaOf(file)) ?? new Set()).add(areaOf(target)))
  return between
}

/** The cycles between areas that are not allowed, and the allowed ones that are cycles no more. */
const cycleBreaches = (
  imports: ReadonlyMap<string, ReadonlyArray<string>>,
  allowed: ReadonlyArray<readonly [string, string, string]>,
) => {
  const between = areasImported(imports)
  const cycles = new Set(
    [...between].flatMap(([a, tos]) =>
      [...tos].filter((b) => a !== b && between.get(b)?.has(a)).map((b) => pairName(a, b)),
    ),
  )
  const listed = new Set(allowed.map(([a, b]) => pairName(a, b)))
  return [
    ...[...cycles]
      .filter((cycle) => !listed.has(cycle))
      .map((cycle) => `${cycle}: two areas import each other; break the cycle`),
    ...[...listed]
      .filter((cycle) => !cycles.has(cycle))
      .map((cycle) => `${cycle}: no longer a cycle; take it off allowedCycles`),
  ].toSorted()
}

/** The breaches of the server's layers among these files' value imports (paths relative to `packages/server/src`). */
export const serverLayerBreaches = (
  imports: ReadonlyMap<string, ReadonlyArray<string>>,
  allowed: ReadonlyArray<readonly [string, string, string]> = allowedCycles,
) => [
  ...[...imports].flatMap(([file, targets]) =>
    targets.flatMap((target) =>
      areaOf(file) === areaOf(target)
        ? []
        : edgeRules.filter(({ breaks }) => breaks(file, target)).map(({ why }) => `${file} -> ${target}: ${why}`),
    ),
  ),
  ...cycleBreaches(imports, allowed),
]

/** The server's value imports, by file relative to `packages/server/src`. */
const serverImports = async (root: string) => {
  const files = (await sourceFiles(root)).filter((file) => file.startsWith(serverRoot))
  const imports = new Map<string, ReadonlyArray<string>>()
  for (const file of files) {
    const requests = valueImportsOf(file, await readFile(posix.join(root, file), 'utf8'))
    imports.set(
      file.slice(serverRoot.length),
      requests
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => posix.normalize(posix.join(dirname(file), specifier)))
        .filter((target) => target.startsWith(serverRoot))
        .map((target) => target.slice(serverRoot.length)),
    )
  }
  return imports
}

/** Check the server's layers; throws with every breach. */
export const checkServerLayers = async (root = '.') => {
  const breaches = serverLayerBreaches(await serverImports(root))
  if (breaches.length > 0) throw new Error(`Server layers:\n${breaches.join('\n')}`)
  return { cycles: allowedCycles.length }
}
