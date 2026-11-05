import { readFile, writeFile } from 'node:fs/promises'
import { Schema } from 'effect'
import { headline, metricNames, takeCensus } from './quality/census.ts'

// The debt ledger: each census count (`quality/census.ts`) has a ceiling in `quality/debt.json` that it may never
// rise above. When a change lowers a count, lower its ceiling in the same commit (`bun tools/debt-check.ts --write`);
// a ceiling is never raised to let a change through. The one exception: debt that was there but hidden from the
// census (a status written inside an SQL string, now a builder call) is re-baselined in the commit that reveals it,
// and that commit's message says so.
//   bun tools/debt-check.ts           the gate
//   bun tools/debt-check.ts --json    the full census, per module (for tools/measure)
//   bun tools/debt-check.ts --write   ceilings lowered to today's counts (never raised)

const ledgerPath = new URL('./quality/debt.json', import.meta.url)
const { census, cycles } = await takeCensus()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ census, cycles }, null, 2))
  process.exit(0)
}

const ledger = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number)))(
  await readFile(ledgerPath, 'utf8'),
)
const current = Object.fromEntries(metricNames.map((metric) => [metric, headline(metric, census[metric])]))

if (process.argv.includes('--write')) {
  const lowered = Object.fromEntries(
    metricNames.map((metric) => [metric, Math.min(ledger[metric] ?? Infinity, current[metric] ?? 0)]),
  )
  await writeFile(ledgerPath, `${JSON.stringify(lowered, null, 2)}\n`)
  console.log('Debt ledger: ceilings lowered to today’s counts')
  process.exit(0)
}

const risen: string[] = []
const fallen: string[] = []
for (const metric of metricNames) {
  const ceiling = ledger[metric]
  const now = current[metric] ?? 0
  if (ceiling === undefined) risen.push(`${metric}: ${now}, no ceiling in quality/debt.json`)
  else if (now > ceiling) {
    const where = Object.entries(census[metric] ?? {})
      .map(([module, value]) => `${module} ${value}`)
      .join(', ')
    risen.push(`${metric}: ${now} > ceiling ${ceiling} (${where})`)
  } else if (now < ceiling) fallen.push(`${metric} ${ceiling} → ${now}`)
}
if (metricNames.includes('modules.cyclePairs') && risen.some((line) => line.startsWith('modules.cyclePairs')))
  risen.push(`cycles now: ${cycles.join(', ')}`)
if (risen.length > 0) {
  console.error(risen.join('\n'))
  throw new Error(`Debt ledger: ${risen.length} counts above their ceiling`)
}
if (fallen.length > 0)
  console.log(`Debt ledger: lower these ceilings (bun tools/debt-check.ts --write): ${fallen.join('; ')}`)
console.log(`Debt ledger: ${metricNames.length} counts at or under their ceilings`)
