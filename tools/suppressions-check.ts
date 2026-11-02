import { readFile } from 'node:fs/promises'
import { Schema } from 'effect'
import { readSource, sourceFiles } from './quality/source.ts'

const Budget = Schema.Array(Schema.Struct({ file: Schema.String, comment: Schema.String }))
const baseline = Schema.decodeUnknownSync(Schema.fromJsonString(Budget))(
  await readFile('tools/suppressions.json', 'utf8'),
)
/**
 * The census of reviewed suppressions: every lint or Effect diagnostic disabled, every TypeScript error silenced and
 * every type assertion's SAFETY comment needs a specific reason, and the set must equal tools/suppressions.json, so
 * each addition or removal is reviewed. Explicit `any` and non-null assertions are lint's (oxlint
 * `typescript/no-explicit-any`, `typescript/no-non-null-assertion`).
 */
const observed: (typeof Budget.Type)[number][] = []
for (const file of await sourceFiles()) {
  const { parsed } = await readSource(file)
  for (const { value } of parsed.comments) {
    const comment = value.trim()
    if (/(?:oxlint|eslint)-disable|@effect-diagnostics|@ts-(?:ignore|expect-error|nocheck)|SAFETY:/.test(comment)) {
      if (!comment.includes(' -- ') || (comment.split(' -- ')[1]?.length ?? 0) < 20)
        throw new Error(`Suppression needs a specific reason in ${file}: ${comment}`)
      observed.push({ file, comment })
    }
  }
}
const canonical = (entries: typeof Budget.Type) =>
  entries
    .map((entry) => JSON.stringify(entry))
    .toSorted()
    .join('\n')
if (canonical(observed) !== canonical(baseline))
  throw new Error('Suppression census changed; review exact additions/removals in tools/suppressions.json')
console.log(`Suppression census: ${observed.length} reviewed directives`)
