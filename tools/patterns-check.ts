import { readFile } from 'node:fs/promises'
import { auditServerFile } from './quality/patterns.ts'
import { sourceFiles } from './quality/source.ts'

// The server's patterns, each the only way its concern is done: the rules and their allowances are in
// `quality/patterns.ts`, with their regression cases beside them.

const root = 'packages/server/src/'

const files = (await sourceFiles()).filter((path) => path.startsWith(root) && !path.endsWith('.generated.ts'))
const breaches: Array<string> = []
for (const path of files)
  for (const breach of auditServerFile(path.slice(root.length), await readFile(path, 'utf8')))
    breaches.push(`${path}: ${breach}`)
if (breaches.length > 0) {
  console.error(breaches.join('\n'))
  throw new Error(`Patterns: ${breaches.length} breaches`)
}
console.log(
  `Patterns: ${files.length} server files; one drizzle, providers own fetch and transports, Config owns env, owners write`,
)
