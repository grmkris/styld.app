import { Predicate } from 'effect'
import { Visitor } from 'oxc-parser'
import { readSource, sourceFiles } from './quality/source.ts'

// The server's patterns, each the only way its concern is done (docs/ARCHITECTURE.md, cleanup): one drizzle over the
// D1 binding (`kernel/Db.ts`), external calls only in `providers/`, the environment read only in `Config.ts` and
// `Resources.ts`, queue bodies routed by their tagged union rather than `'x' in body`, no stand-ins in production
// source, and every table written only by the module that owns it. Each allowance below names why it is one.

const root = 'packages/server/src/'

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
}

/** `'x' in y` checks. */
const inAllowed: Allowances = {
  'EdgeMeta.ts': "the edge Worker is plain TypeScript, without Effect's Schema or Predicate, to stay small",
}

/** Every table of `@styld/db` a server module writes, and who may write it: a folder (`capture/`) or a file. */
const owners: Readonly<Record<string, ReadonlyArray<string>>> = {
  accounts: ['AccountLifecycle.ts'],
  oauthGrants: ['AccountLifecycle.ts'],
  pieces: ['wardrobe/'],
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
  boardImages: ['boards/'],
  profiles: ['social/'],
  follows: ['social/'],
  blocks: ['social/'],
  saves: ['social/'],
  reports: ['social/'],
  contentChecks: ['safety/'],
  generationJobs: ['generation/'],
  generationPictures: ['generation/'],
  thinkingDays: ['outfits/'],
  wornPieces: ['worn/'],
  // Every operation writes its receipt in its own batch (`kernel/Receipts.ts`).
  operationReceipts: ['*'],
}

const writes = new Set(['insert', 'update', 'delete'])

const ownedBy = (table: string, file: string) =>
  (owners[table] ?? []).some(
    (owner) => owner === '*' || (owner.endsWith('/') ? file.startsWith(owner) : file === owner),
  )

/** The name a call calls: `fetch(…)` and `db.insert(…)` alike. */
const calledName = (callee: object) => {
  if (Predicate.hasProperty(callee, 'name') && Predicate.isString(callee.name)) return callee.name
  const property = Predicate.hasProperty(callee, 'property') ? callee.property : undefined
  return Predicate.hasProperty(property, 'name') && Predicate.isString(property.name) ? property.name : undefined
}

const breaches: Array<string> = []

/** One file's breaches. */
const audit = async (path: string) => {
  const file = path.slice(root.length)
  const { source, parsed } = await readSource(path)
  const breach = (what: string) => breaches.push(`${path}: ${what}`)
  if (/\bstand-?in(?!g)/iu.test(source))
    breach('a stand-in in production source; fakes are layers in packages/server/test')
  const tables = new Set<string>()
  new Visitor({
    ImportDeclaration: (node) => {
      if (node.source.value !== '@styld/db') return
      for (const specifier of node.specifiers)
        if (specifier.type === 'ImportSpecifier') tables.add(specifier.local.name)
    },
  }).visit(parsed.program)
  new Visitor({
    CallExpression: (node) => {
      const called = calledName(node.callee)
      if (node.callee.type === 'Identifier' && called === 'drizzle' && file !== 'kernel/Db.ts')
        breach('drizzle( outside kernel/Db.ts; take the Database service')
      if (called === 'fetch' && !file.startsWith('providers/') && fetchAllowed[file] === undefined)
        breach('fetch( outside providers/; call the provider through its adapter')
      const [first] = node.arguments
      const table = first?.type === 'Identifier' && tables.has(first.name) ? first.name : undefined
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
}

const files = (await sourceFiles()).filter((path) => path.startsWith(root) && !path.endsWith('.generated.ts'))
for (const path of files) await audit(path)
if (breaches.length > 0) {
  console.error(breaches.join('\n'))
  throw new Error(`Patterns: ${breaches.length} breaches`)
}
console.log(`Patterns: ${files.length} server files; one drizzle, providers own fetch, Config owns env, owners write`)
