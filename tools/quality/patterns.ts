import { Predicate } from 'effect'
import { parseSync, Visitor } from 'oxc-parser'

// The server's patterns, each the only way its concern is done (docs/ARCHITECTURE.md, cleanup): one drizzle over the
// D1 binding (`kernel/Db.ts`), external calls and HTTP transports only in `providers/`, the environment read only in
// `Config.ts` and `Resources.ts`, queue bodies routed by their tagged union rather than `'x' in body`, no stand-ins in
// production source, and every table written only by the module that owns it. Names are resolved through the file's
// imports, so an alias (`drizzle as makeDb`) or a namespace (`import * as tables`) is the same thing it imports. Each
// allowance below names why it is one.

/** Files an allowance applies to, relative to the server's `src/`, with the reason it is not a breach. */
type Allowances = Readonly<Record<string, string>>

/** Raw `fetch` beyond `providers/`: calls that are not external provider calls. */
const fetchAllowed: Allowances = {
  'EdgeWorker.ts': 'the edge Worker forwards to the API Worker and the website over their service bindings',
  'mcp/Sdk.ts': "the MCP SDK's own request handler, called in process; nothing leaves the Worker",
}

/** `env.` beyond `Config.ts` and `Resources.ts`. */
const envAllowed: Allowances = {
  'EdgeWorker.ts': 'the edge Worker is plain TypeScript and reads its own two service bindings and robots flag',
  'providers/StylistModel.ts':
    "the Thread Worker's model reads its own call dataset binding through effect-cf; scalars come through Config",
  'stylist/Thread.ts':
    "the Thread Worker is a plain module: its Objects and entrypoint read its own bindings (the API Worker, the Objects' namespace)",
}

/** `'x' in y` checks. */
const inAllowed: Allowances = {
  'EdgeMeta.ts': "the edge Worker is plain TypeScript, without Effect's Schema or Predicate, to stay small",
}

/** Modules that make an HTTP transport: whoever imports one sends requests of its own, which only `providers/` do. */
const transportModules = new Set(['effect/http/FetchHttpClient', 'effect/unstable/http/FetchHttpClient'])

/** Modules whose `drizzle` makes a database: only `kernel/Db.ts` makes the one. */
const drizzleModules = new Set([
  'drizzle-orm/d1',
  'drizzle-orm/libsql',
  'drizzle-orm/better-sqlite3',
  'drizzle-orm/durable-sqlite',
])

/** Every table of `@styld/db` a server module writes, and who may write it: a folder (`capture/`) or a file. */
const owners: Readonly<Record<string, ReadonlyArray<string>>> = {
  accounts: ['AccountLifecycle.ts'],
  accountDeletions: ['AccountLifecycle.ts'],
  oauthGrants: ['AccountLifecycle.ts'],
  providerFiles: ['capture/'],
  pieces: ['wardrobe/'],
  pieceProvenance: ['wardrobe/'],
  uploads: ['wardrobe/'],
  piecePictures: ['capture/'],
  pieceTurns: ['capture/'],
  captures: ['capture/'],
  captureFrames: ['capture/'],
  detections: ['capture/'],
  outfitPhotos: ['photos/'],
  photoGarments: ['photos/'],
  looks: ['looks/'],
  lookPieces: ['looks/'],
  boards: ['boards/'],
  boardItems: ['boards/'],
  boardPins: ['boards/'],
  boardOutfits: ['boards/'],
  boardOutfitPieces: ['boards/'],
  boardImages: ['boards/'],
  boardTags: ['boards/'],
  boardTranslations: ['boards/'],
  profiles: ['social/'],
  follows: ['social/'],
  blocks: ['social/'],
  saves: ['social/'],
  reports: ['social/'],
  profileTranslations: ['social/'],
  viewerPreferences: ['social/'],
  contentChecks: ['safety/'],
  generationJobs: ['generation/'],
  generationPictures: ['generation/'],
  generationPicks: ['generation/'],
  thinkingDays: ['outfits/'],
  wornPieces: ['worn/'],
  stylistChats: ['stylist/'],
  pendingSettlements: ['usage/'],
  paidAttempts: ['usage/'],
  importedPieces: ['imports/'],
  importCopies: ['imports/'],
  seededBoards: ['seed/'],
  // Every operation writes its receipt in its own batch (`kernel/Receipts.ts`).
  operationReceipts: ['*'],
}

const writes = new Set(['insert', 'update', 'delete'])

const ownedBy = (table: string, file: string) =>
  (owners[table] ?? []).some(
    (owner) => owner === '*' || (owner.endsWith('/') ? file.startsWith(owner) : file === owner),
  )

const nameOf = (node: unknown) =>
  Predicate.hasProperty(node, 'name') && Predicate.isString(node.name) ? node.name : undefined

/** The name a call calls: `fetch(…)` and `db.insert(…)` alike. */
const calledName = (callee: object) =>
  nameOf(callee) ?? (Predicate.hasProperty(callee, 'property') ? nameOf(callee.property) : undefined)

/** A member read `namespace.member` of an identifier, as its two names. */
const memberOf = (node: unknown) => {
  if (!Predicate.hasProperty(node, 'type') || node.type !== 'MemberExpression') return undefined
  if (!Predicate.hasProperty(node, 'object') || !Predicate.hasProperty(node, 'property')) return undefined
  const namespace =
    Predicate.hasProperty(node.object, 'type') && node.object.type === 'Identifier' ? nameOf(node.object) : undefined
  const member = nameOf(node.property)
  return namespace === undefined || member === undefined ? undefined : { namespace, member }
}

/** One value an import binds: its local name, the name it imports (none for a namespace or a default). */
interface Binding {
  readonly local: string
  readonly imported: string | undefined
  readonly namespace: boolean
}

/** What the file's imports name: each local name of a `@styld/db` table with the table it is, the namespaces of
 * `@styld/db`, the local names of `drizzle` and the namespaces of its drivers, and the transports it imports. */
interface Imported {
  readonly tables: Map<string, string>
  readonly tableNamespaces: Set<string>
  readonly drizzles: Set<string>
  readonly drizzleNamespaces: Set<string>
  readonly transports: Array<string>
}

/** Record what one value import binds. */
const bind = (found: Imported, from: string, { local, imported, namespace }: Binding) => {
  if (from === '@styld/db' && namespace) found.tableNamespaces.add(local)
  if (from === '@styld/db' && imported !== undefined) found.tables.set(local, imported)
  if (drizzleModules.has(from) && namespace) found.drizzleNamespaces.add(local)
  if (drizzleModules.has(from) && imported === 'drizzle') found.drizzles.add(local)
}

const importsIn = (program: Parameters<Visitor['visit']>[0]) => {
  const found: Imported = {
    tables: new Map(),
    tableNamespaces: new Set(),
    drizzles: new Set(),
    drizzleNamespaces: new Set(),
    transports: [],
  }
  new Visitor({
    ImportDeclaration: (node) => {
      const from = node.source.value
      if (node.importKind === 'type') return
      if (transportModules.has(from)) found.transports.push(from)
      const values = node.specifiers.filter(
        (specifier) => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type',
      )
      for (const specifier of values)
        bind(found, from, {
          local: specifier.local.name,
          imported: specifier.type === 'ImportSpecifier' ? nameOf(specifier.imported) : undefined,
          namespace: specifier.type === 'ImportNamespaceSpecifier',
        })
    },
  }).visit(program)
  return found
}

/** One server file's breaches, `file` relative to the server's `src/`. */
export const auditServerFile = (file: string, source: string): ReadonlyArray<string> => {
  const parsed = parseSync(file, source)
  if (parsed.errors.length !== 0) throw new Error(`Cannot audit ${file}: ${parsed.errors[0]?.message}`)
  const breaches: Array<string> = []
  const breach = (what: string) => breaches.push(what)
  if (/\bstand-?in(?!g)/iu.test(source))
    breach('a stand-in in production source; fakes are layers in packages/server/test')
  const imported = importsIn(parsed.program)
  const external = !file.startsWith('providers/')
  for (const transport of imported.transports)
    if (external) breach(`${transport} imported outside providers/; send requests through a provider's adapter`)
  /** The table a write's first argument names: an imported table, under any alias or namespace. */
  const tableOf = (argument: unknown) => {
    const name =
      Predicate.hasProperty(argument, 'type') && argument.type === 'Identifier' ? nameOf(argument) : undefined
    if (name !== undefined) return imported.tables.get(name)
    const member = memberOf(argument)
    return member !== undefined && imported.tableNamespaces.has(member.namespace) ? member.member : undefined
  }
  new Visitor({
    CallExpression: (node) => {
      const called = calledName(node.callee)
      const member = memberOf(node.callee)
      const makesDatabase =
        (node.callee.type === 'Identifier' && imported.drizzles.has(called ?? '')) ||
        (member !== undefined && imported.drizzleNamespaces.has(member.namespace) && member.member === 'drizzle')
      if (makesDatabase && file !== 'kernel/Db.ts') breach('drizzle( outside kernel/Db.ts; take the Database service')
      if (called === 'fetch' && external && fetchAllowed[file] === undefined)
        breach('fetch( outside providers/; call the provider through its adapter')
      const table = tableOf(node.arguments[0])
      if (called !== undefined && writes.has(called) && table !== undefined && !ownedBy(table, file))
        breach(`.${called}(${table}) outside its owner (${(owners[table] ?? ['none listed']).join(', ')})`)
    },
    MemberExpression: (node) => {
      const reads =
        (node.object.type === 'Identifier' && node.object.name === 'env') ||
        (node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'env')
      if (reads && !['Config.ts', 'Resources.ts'].includes(file) && envAllowed[file] === undefined)
        breach('env. read outside Config.ts and Resources.ts; decode it once in Config.ts')
    },
    BinaryExpression: (node) => {
      if (node.operator === 'in' && node.left.type === 'Literal' && inAllowed[file] === undefined)
        breach(`'${String(node.left.value)}' in …; decode the body's tagged union or use Predicate`)
    },
  }).visit(parsed.program)
  return breaches
}
