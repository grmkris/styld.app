import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { parseSync, Visitor } from 'oxc-parser'
import { importsOf, sourceFiles } from './source.ts'

// The debt census: counts of the patterns the 5 November 2026 review named, per module. `debt.json` holds a ceiling
// for each count; `tools/debt-check.ts` fails when a count rises above it, and the measurement report
// (`tools/measure/report.ts`) compares two censuses. A count only goes down: lower its ceiling in the commit that
// lowers it.

export type Counts = Readonly<Record<string, number>>
export type Census = Readonly<Record<string, Counts>>

const server = 'packages/server/src/'
const auth = 'packages/auth/src/'
const web = 'apps/web/src/'

const isTest = (path: string) => /\.(test|spec|native\.test)\.ts$/u.test(path) || path.includes('/test/')

/** The module a source file belongs to: its first folder under its package's `src`, or `root`. */
const moduleOf = (path: string): string => {
  for (const prefix of [server, auth, web, 'packages/', 'tools/']) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const folder = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : 'root'
    return prefix === 'packages/' ? `packages/${folder}` : `${prefix.replace(/\/src\/$|\/$/u, '')}:${folder}`
  }
  return 'root'
}

const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0

/** Text patterns, counted in production source (tests are not debt). */
const textual: ReadonlyArray<{
  readonly name: string
  readonly where: (path: string) => boolean
  readonly pattern: RegExp
}> = [
  { name: 'effect.orDie', where: (p) => p.startsWith('packages/'), pattern: /\borDie\b/gu },
  { name: 'effect.ignore', where: (p) => p.startsWith('packages/'), pattern: /\bEffect\.ignore(?:Logged)?\b/gu },
  { name: 'effect.orElseSucceed', where: (p) => p.startsWith('packages/'), pattern: /\borElseSucceed\b/gu },
  { name: 'effect.catchCause', where: (p) => p.startsWith('packages/'), pattern: /\bcatch(?:All)?Cause\b/gu },
  {
    name: 'errors.causeDropped',
    where: (p) => p.startsWith('packages/'),
    pattern: /\bcatch:\s*(?:\(\s*\)\s*=>|unavailable\b|unknown\b)/gu,
  },
  { name: 'promise.runPromise', where: (p) => p.startsWith('packages/'), pattern: /\bEffect\.runPromise(?:With)?\b/gu },
  {
    name: 'sql.wholeStatements',
    where: (p) => p.startsWith('packages/') || p.startsWith('tools/'),
    pattern: /\.(?:run|all|get|values)\(\s*sql`|\.prepare\(\s*['"`]|\$client\b/giu,
  },
  {
    name: 'sql.textSubqueries',
    where: (p) => p.startsWith('packages/') && !p.startsWith('packages/db/'),
    pattern: /sql`[\s(]*(?:select|insert|update|delete|with|exists\s*\(\s*select)\b/giu,
  },
  {
    name: 'sql.fragments',
    where: (p) => p.startsWith('packages/') && !p.startsWith('packages/db/'),
    pattern: /\bsql`/gu,
  },
  {
    name: 'lifecycle.statusLiterals',
    where: (p) => p.startsWith(server),
    pattern: /\b(?:status|state):\s*'[a-z][a-zA-Z_-]*'/gu,
  },
  { name: 'json.parse', where: (p) => p.startsWith('packages/'), pattern: /\bJSON\.parse\(/gu },
  {
    name: 'mcp.inlineSchemas',
    where: (p) => p.startsWith(`${server}mcp/`) && p.endsWith('Tools.ts'),
    pattern: /\bSchema\.Struct\(/gu,
  },
  {
    name: 'web.colourLiterals',
    where: (p) => p.startsWith(web) && p.endsWith('.styles.ts'),
    pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:oklch|rgba?|hsla?)\(/gu,
  },
  {
    name: 'web.stringIds',
    where: (p) => p.startsWith(web),
    pattern: /\b[a-z]\w*Id:\s*(?:Schema|S)\.String\b|\bid:\s*(?:Schema|S)\.String\b/gu,
  },
  {
    name: 'dup.unavailableHelpers',
    where: (p) => p.startsWith('packages/'),
    pattern: /\bconst (?:unavailable|stored)\s*=/gu,
  },
  { name: 'dup.patienceMillis', where: (p) => p.startsWith('packages/'), pattern: /\bpatienceMillis\s*=/gu },
  {
    name: 'dup.htmlEscapes',
    where: (p) => !p.startsWith('repos/'),
    pattern: /replaceAll\('&', '&amp;'\)|'&': '&amp;'/gu,
  },
]

/** The largest Foldkit Message union in a file: the keys of `defineMessageUnion({...})`. */
const messageVariants = (path: string, source: string): number => {
  if (!source.includes('defineMessageUnion')) return 0
  const parsed = parseSync(path, source)
  let largest = 0
  new Visitor({
    CallExpression: (node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineMessageUnion') return
      const argument = node.arguments[0]
      if (argument?.type === 'ObjectExpression') largest = Math.max(largest, argument.properties.length)
    },
  }).visit(parsed.program)
  return largest
}

/** Which db schema file each table export comes from: the table's owning module (`packages/db/src/index.ts`). */
const tableOwners = async (): Promise<ReadonlyMap<string, string>> => {
  const path = 'packages/db/src/index.ts'
  const parsed = parseSync(path, await readFile(path, 'utf8'))
  const owners = new Map<string, string>()
  new Visitor({
    ExportNamedDeclaration: (node) => {
      if (node.source === null) return
      const owner = node.source.value.replace(/^\.\//u, '').replace(/\.ts$/u, '')
      for (const specifier of node.specifiers)
        if (specifier.exported.type === 'Identifier') owners.set(specifier.exported.name, owner)
    },
  }).visit(parsed.program)
  return owners
}

/** Tables a server file imports from `@styld/db` that another module owns. */
const foreignTables = (path: string, source: string, owners: ReadonlyMap<string, string>): number => {
  if (!path.startsWith(server) || !source.includes('@styld/db')) return 0
  const module = moduleOf(path).split(':')[1] ?? 'root'
  const parsed = parseSync(path, source)
  let foreign = 0
  new Visitor({
    ImportDeclaration: (node) => {
      if (node.source.value !== '@styld/db' || node.importKind === 'type') return
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue
        const name = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
        const owner = owners.get(name)
        if (owner !== undefined && owner !== module) foreign += 1
      }
    },
  }).visit(parsed.program)
  return foreign
}

/** Pairs of server modules that import each other (the composition root excluded). */
const moduleCycles = (graph: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyArray<string> => {
  const pairs: string[] = []
  for (const [from, targets] of graph)
    for (const to of targets) if (from < to && graph.get(to)?.has(from) === true) pairs.push(`${from}<->${to}`)
  return pairs.toSorted()
}

type Tally = Map<string, Map<string, number>>

const tally = (
  census: Tally,
  metric: string,
  module: string,
  value: number,
  merge: (a: number, b: number) => number,
) => {
  if (value === 0) return
  const counts = census.get(metric) ?? new Map<string, number>()
  counts.set(module, merge(counts.get(module) ?? 0, value))
  census.set(metric, counts)
}
const added = (a: number, b: number) => a + b

/** The server modules a server file imports, by relative path (the composition root excluded). */
const serverModulesImported = (path: string, source: string): ReadonlyArray<string> =>
  importsOf(path, source)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => normalize(join(dirname(path), specifier)))
    .filter((target) => target.startsWith(server))
    .map((target) => moduleOf(target).split(':')[1] ?? 'root')
    .filter((to) => to !== 'root')

const censusFiles = async () =>
  (await sourceFiles()).filter(
    (path) =>
      !isTest(path) &&
      !path.endsWith('.generated.ts') &&
      !path.startsWith('tools/quality/census') &&
      path !== 'tools/quality/patterns.ts',
  )

const sorted = (census: Tally): Census =>
  Object.fromEntries(
    [...census]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([metric, counts]) => [metric, Object.fromEntries([...counts].toSorted(([a], [b]) => a.localeCompare(b)))]),
  )

export const takeCensus = async (): Promise<{ readonly census: Census; readonly cycles: ReadonlyArray<string> }> => {
  const owners = await tableOwners()
  const census: Tally = new Map()
  const graph = new Map<string, Set<string>>()
  for (const path of await censusFiles()) {
    const source = await readFile(path, 'utf8')
    const module = moduleOf(path)
    for (const { name, pattern } of textual.filter((metric) => metric.where(path)))
      tally(census, name, module, count(source, pattern), added)
    if (path.startsWith(web))
      tally(census, 'web.messageVariantsMax', path.slice(web.length), messageVariants(path, source), Math.max)
    tally(census, 'modules.foreignTableImports', module, foreignTables(path, source, owners), added)
    const from = module.split(':')[1] ?? 'root'
    if (!path.startsWith(server) || from === 'root') continue
    const targets = graph.get(from) ?? new Set<string>()
    for (const to of serverModulesImported(path, source)) if (to !== from) targets.add(to)
    graph.set(from, targets)
  }
  const cycles = moduleCycles(graph)
  tally(census, 'modules.cyclePairs', 'packages/server', cycles.length, added)
  return { census: sorted(census), cycles }
}

/** A metric's headline: the largest entry for a `Max` metric, the sum for the others. */
export const headline = (metric: string, counts: Counts | undefined): number => {
  const values = Object.values(counts ?? {})
  if (values.length === 0) return 0
  return metric.endsWith('Max') ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0)
}

export const metricNames = [
  ...textual.map(({ name }) => name),
  'web.messageVariantsMax',
  'modules.foreignTableImports',
  'modules.cyclePairs',
].toSorted()
