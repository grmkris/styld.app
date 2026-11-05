import { readFile } from 'node:fs/promises'
import { auditRawSql, auditServerFile } from './quality/patterns.ts'
import { sourceFiles } from './quality/source.ts'

// The server's patterns, each the only way its concern is done, and Drizzle-built SQL in the server, auth and tools:
// the rules and their allowances are in `quality/patterns.ts`, with their regression cases beside them. Tests under
// packages/*/test are out of the SQL rule's scope.

const root = 'packages/server/src/'
const sqlRoots = [root, 'packages/auth/src/', 'tools/']

const all = (await sourceFiles()).filter((path) => !path.endsWith('.generated.ts'))
const files = all.filter((path) => path.startsWith(root))
const sqlFiles = all.filter((path) => sqlRoots.some((sqlRoot) => path.startsWith(sqlRoot)))
const breaches: Array<string> = []
for (const path of files)
  for (const breach of auditServerFile(path.slice(root.length), await readFile(path, 'utf8')))
    breaches.push(`${path}: ${breach}`)
for (const path of sqlFiles)
  for (const breach of auditRawSql(path, await readFile(path, 'utf8'))) breaches.push(`${path}: ${breach}`)
if (breaches.length > 0) {
  console.error(breaches.join('\n'))
  throw new Error(`Patterns: ${breaches.length} breaches`)
}
console.log(
  `Patterns: ${files.length} server files; one drizzle, providers own fetch and transports, Config owns env, owners ` +
    `write; ${sqlFiles.length} server, auth and tools files build their SQL with Drizzle`,
)
