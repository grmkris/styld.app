/**
 * What capture providers cost and how often their pieces are kept, from the Worker's Analytics Engine
 * dataset (`packages/server/src/kernel/Metrics.ts` writes it):
 *
 *   bun tools/ai-usage-report.ts [stage=preview] [days=7]
 *
 * Each stage counts in its own dataset (`packages/server/src/Resources.ts` `stages`). Reads `CLOUDFLARE_API_TOKEN` (Account Analytics read) and `CLOUDFLARE_ACCOUNT_ID` (default: the v2
 * preview account) from the environment and never prints them. Costs are list-price estimates; the
 * providers' invoices are the truth. Analytics Engine samples per index, so every sum is weighted by
 * `_sample_interval`; indexes are `call.<provider>.<kind>`, `review.<decision>` (plain `call` and
 * `review` before 2026-10-29 16:00), `picture.<state>`, where each clean picture ended (from 2026-10-30), and
 * `outfit.<make|keep>.<mode>`, the outfit engine's Fast and Thinking experiment (from 2026-10-31), and
 * `landing.shown.<hero>` and `signin.started.<hero>`, the signed-out Home's three heroes, which the edge counts
 * (from 2026-11-04).
 */
import { isStageName, stages } from '@styld/server/Resources'
import { Schema } from 'effect'

const [stage = 'preview', days = '7'] = process.argv.slice(2)
const token = process.env['CLOUDFLARE_API_TOKEN']
const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? 'bceaeae4788dce3493514fde194b4a7e'
if (token === undefined) throw new Error('Set CLOUDFLARE_API_TOKEN')
if (!isStageName(stage) || !/^\d{1,3}$/.test(days))
  throw new Error(`Usage: bun tools/ai-usage-report.ts [${Object.keys(stages).join('|')}] [days]`)
const { aiCalls: dataset, environment } = stages[stage]

const Rows = Schema.Struct({ data: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) })

const query = async (sql: string) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: sql,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Analytics Engine answered ${response.status}: ${text.slice(0, 300)}`)
  return Schema.decodeUnknownSync(Rows)(JSON.parse(text)).data
}

const within = `blob1 = '${environment}' AND timestamp > NOW() - INTERVAL '${days}' DAY`

const calls = await query(`
  SELECT blob3 AS provider, blob4 AS model, blob5 AS kind, blob6 AS outcome,
         SUM(_sample_interval) AS calls,
         SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_ms,
         SUM(_sample_interval * double2) AS units,
         SUM(_sample_interval * double3) / 1000000 AS est_usd
  FROM ${dataset}
  WHERE index1 LIKE 'call%' AND ${within}
  GROUP BY provider, model, kind, outcome
  ORDER BY est_usd DESC
  FORMAT JSON`)

const reviews = await query(`
  SELECT blob3 AS route, blob4 AS provider, blob5 AS decision, SUM(_sample_interval) AS pieces
  FROM ${dataset}
  WHERE index1 LIKE 'review%' AND ${within}
  GROUP BY route, provider, decision
  ORDER BY pieces DESC
  FORMAT JSON`)

console.log(`Provider calls, ${stage}, last ${days} days`)
console.table(calls)
const total = calls.reduce((sum, row) => sum + Number(row['est_usd'] ?? 0), 0)
console.log(`Estimated total: $${total.toFixed(4)}`)
const pictures = await query(`
  SELECT blob3 AS state, blob4 AS provider, blob5 AS asked, SUM(_sample_interval) AS pictures
  FROM ${dataset}
  WHERE index1 LIKE 'picture.%' AND ${within}
  GROUP BY state, provider, asked
  ORDER BY pictures DESC
  FORMAT JSON`)

console.log('Review decisions')
console.table(reviews)
console.log('Clean pictures: shown (ready), offered (proposed), dropped (rejected), retake, kept-real, failed')
console.table(pictures)

const outfitMakes = await query(`
  SELECT blob4 AS mode, blob5 AS outcome, blob7 AS judged,
         SUM(_sample_interval) AS makes,
         quantileExactWeighted(0.5)(double1, _sample_interval) AS p50_ms,
         quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms,
         SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_proposals,
         SUM(_sample_interval * double3) / 1000000 AS est_usd
  FROM ${dataset}
  WHERE index1 LIKE 'outfit.make.%' AND ${within}
  GROUP BY mode, outcome, judged
  ORDER BY mode, makes DESC
  FORMAT JSON`)

const outfitKeeps = await query(`
  SELECT blob4 AS mode, blob5 AS outcome,
         SUM(_sample_interval) AS kept,
         SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_position,
         SUM(if(blob7 = 'edited', _sample_interval, 0)) AS edited
  FROM ${dataset}
  WHERE index1 LIKE 'outfit.keep.%' AND ${within}
  GROUP BY mode, outcome
  FORMAT JSON`)

const sessionsBy = async (phase: 'make' | 'keep') =>
  new Map(
    (
      await query(`
        SELECT blob4 AS mode, COUNT(DISTINCT blob6) AS sessions
        FROM ${dataset}
        WHERE index1 LIKE 'outfit.${phase}.%' AND ${within}
        GROUP BY mode
        FORMAT JSON`)
    ).map((row) => [String(row['mode']), Number(row['sessions'] ?? 0)]),
  )
const madeSessions = await sessionsBy('make')
const keptSessions = await sessionsBy('keep')
const keepRates = ['fast', 'thinking'].map((mode) => {
  const made = madeSessions.get(mode) ?? 0
  const kept = keptSessions.get(mode) ?? 0
  const cost = outfitMakes
    .filter((row) => row['mode'] === mode)
    .reduce((sum, row) => sum + Number(row['est_usd'] ?? 0), 0)
  const keeps = outfitKeeps
    .filter((row) => row['mode'] === mode)
    .reduce((sum, row) => sum + Number(row['kept'] ?? 0), 0)
  return {
    mode,
    sessions: made,
    keptSessions: kept,
    keepRate: made === 0 ? null : kept / made,
    usdPerKept: keeps === 0 ? null : cost / keeps,
  }
})

console.log('Outfits made: latency, proposals and cost by way, outcome and whether Clef ranked them')
console.table(outfitMakes)
console.log('Outfits kept: worn today or kept on a board; avg_position is how far into a run the kept one was shown')
console.table(outfitKeeps)
console.log('Fast against Thinking: runs, runs with a keep, keep rate and estimated cost per kept outfit')
console.table(keepRates)

const landing = await query(`
  SELECT blob4 AS hero,
         SUM(if(blob3 = 'landing.shown', _sample_interval, 0)) AS shown,
         SUM(if(blob3 = 'signin.started', _sample_interval, 0)) AS sign_ins_begun
  FROM ${dataset}
  WHERE (index1 LIKE 'landing.shown.%' OR index1 LIKE 'signin.started.%') AND ${within}
  GROUP BY hero
  ORDER BY hero
  FORMAT JSON`)

console.log('Landing heroes: signed-out Homes shown, and sign-ins begun by browsers that were shown each one')
console.table(
  landing.map((row) => {
    const shown = Number(row['shown'] ?? 0)
    const begun = Number(row['sign_ins_begun'] ?? 0)
    return { hero: row['hero'], shown, signInsBegun: begun, rate: shown === 0 ? null : begun / shown }
  }),
)
