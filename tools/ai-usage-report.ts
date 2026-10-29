/**
 * What capture providers cost and how often their pieces are kept, from the Worker's Analytics Engine
 * dataset (`packages/server/src/capture/Metrics.ts` writes it):
 *
 *   bun tools/ai-usage-report.ts [environment=preview] [days=7]
 *
 * Reads `CLOUDFLARE_API_TOKEN` (Account Analytics read) and `CLOUDFLARE_ACCOUNT_ID` (default: the v2
 * preview account) from the environment and never prints them. Costs are list-price estimates; the
 * providers' invoices are the truth. Analytics Engine samples at high volume, so every sum is weighted
 * by `_sample_interval`.
 */
import { Schema } from 'effect'

const [environment = 'preview', days = '7'] = process.argv.slice(2)
const token = process.env['CLOUDFLARE_API_TOKEN']
const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? 'bceaeae4788dce3493514fde194b4a7e'
if (token === undefined) throw new Error('Set CLOUDFLARE_API_TOKEN')
if (!/^[a-z]+$/.test(environment) || !/^\d{1,3}$/.test(days))
  throw new Error('Usage: bun tools/ai-usage-report.ts [environment] [days]')

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
  FROM StyldV2AiCalls
  WHERE index1 = 'call' AND ${within}
  GROUP BY provider, model, kind, outcome
  ORDER BY est_usd DESC
  FORMAT JSON`)

const reviews = await query(`
  SELECT blob3 AS route, blob4 AS provider, blob5 AS decision, SUM(_sample_interval) AS pieces
  FROM StyldV2AiCalls
  WHERE index1 = 'review' AND ${within}
  GROUP BY route, provider, decision
  ORDER BY pieces DESC
  FORMAT JSON`)

console.log(`Provider calls, ${environment}, last ${days} days`)
console.table(calls)
const total = calls.reduce((sum, row) => sum + Number(row['est_usd'] ?? 0), 0)
console.log(`Estimated total: $${total.toFixed(4)}`)
console.log('Review decisions')
console.table(reviews)
