// What Cloudflare saw while a measurement ran, read-only: each Worker's invocations (GraphQL analytics), the Workers
// Logs of the window (exceptions, CPU limits, slow requests) and the provider calls Analytics Engine counted. Needs
// `CLOUDFLARE_API_TOKEN` with Account Analytics and Workers Observability read.
import { Schema } from 'effect'

const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '849414470335f8f59091e26df5ae86c5'
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`

const token = () => {
  const value = process.env['CLOUDFLARE_API_TOKEN']
  if (value === undefined || value === '') throw new Error('Set CLOUDFLARE_API_TOKEN')
  return value
}

const post = async (url: string, body: string, contentType = 'application/json'): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': contentType },
    body,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

export interface Window {
  readonly from: Date
  readonly to: Date
}

const Invocations = Schema.Struct({
  data: Schema.Struct({
    viewer: Schema.Struct({
      accounts: Schema.Array(
        Schema.Struct({
          workersInvocationsAdaptive: Schema.Array(
            Schema.Struct({
              dimensions: Schema.Struct({ scriptName: Schema.String }),
              sum: Schema.Struct({ requests: Schema.Number, errors: Schema.Number, subrequests: Schema.Number }),
              quantiles: Schema.Struct({
                cpuTimeP50: Schema.Number,
                cpuTimeP99: Schema.Number,
                wallTimeP50: Schema.Number,
                wallTimeP99: Schema.Number,
              }),
            }),
          ),
        }),
      ),
    }),
  }),
})

/** The role of a stage's Worker from its script name: edge, api, website or stylist. */
const roleOf = (script: string) =>
  script.includes('styldedge')
    ? 'edge'
    : script.includes('styldworker')
      ? 'api'
      : script.includes('styldwebsite')
        ? 'website'
        : script.includes('stylist')
          ? 'stylist'
          : 'other'

export interface WorkerUse {
  readonly role: string
  readonly requests: number
  readonly errors: number
  readonly subrequests: number
  /** Milliseconds. */
  readonly cpuP50: number
  readonly cpuP99: number
  readonly wallP50: number
  readonly wallP99: number
}

/** Each of the stage's Workers in the window: requests, errors, CPU and wall time (GraphQL, microseconds → ms). */
export const workerUse = async (stage: string, window: Window): Promise<ReadonlyArray<WorkerUse>> => {
  const query = `{ viewer { accounts(filter: {accountTag: "${account}"}) { workersInvocationsAdaptive(limit: 50,
    filter: {datetime_geq: "${window.from.toISOString()}", datetime_leq: "${window.to.toISOString()}"}) {
    dimensions { scriptName } sum { requests errors subrequests }
    quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 } } } } }`
  const answer = Schema.decodeUnknownSync(Invocations)(
    await post('https://api.cloudflare.com/client/v4/graphql', JSON.stringify({ query })),
  )
  const rows = answer.data.viewer.accounts[0]?.workersInvocationsAdaptive ?? []
  return rows
    .filter(
      ({ dimensions }) =>
        dimensions.scriptName.startsWith('styldappv2-') && dimensions.scriptName.includes(`-${stage}-`),
    )
    .map(({ dimensions, sum, quantiles }) => ({
      role: roleOf(dimensions.scriptName),
      requests: sum.requests,
      errors: sum.errors,
      subrequests: sum.subrequests,
      cpuP50: quantiles.cpuTimeP50 / 1000,
      cpuP99: quantiles.cpuTimeP99 / 1000,
      wallP50: quantiles.wallTimeP50 / 1000,
      wallP99: quantiles.wallTimeP99 / 1000,
    }))
    .toSorted((a, b) => a.role.localeCompare(b.role))
}

const Calculations = Schema.Struct({
  result: Schema.Struct({
    calculations: Schema.Array(
      Schema.Struct({
        aggregates: Schema.Array(
          Schema.Struct({
            value: Schema.Number,
            groups: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.Unknown }))),
          }),
        ),
      }),
    ),
  }),
})

/** How many Workers Logs events in the window match the filters (the stage's Workers only). */
const logCount = async (stage: string, window: Window, filters: ReadonlyArray<object>): Promise<number> => {
  const body = {
    queryId: 'styld-measure',
    timeframe: { from: window.from.getTime(), to: window.to.getTime() },
    view: 'calculations',
    parameters: {
      filters: [{ key: '$metadata.service', operation: 'includes', type: 'string', value: `-${stage}-` }, ...filters],
      calculations: [{ operator: 'count' }],
    },
  }
  const answer = Schema.decodeUnknownSync(Calculations)(
    await post(`${api}/workers/observability/telemetry/query`, JSON.stringify(body)),
  )
  return answer.result.calculations[0]?.aggregates.reduce((sum, { value }) => sum + value, 0) ?? 0
}

export interface LogCounts {
  readonly exceptions: number
  readonly exceededCpu: number
  readonly slowOver3s: number
}

/** Exceptions, CPU-limit cancels and requests slower than three seconds in the window. */
export const logCounts = async (stage: string, window: Window): Promise<LogCounts> => ({
  exceptions: await logCount(stage, window, [
    { key: '$workers.outcome', operation: 'eq', type: 'string', value: 'exception' },
  ]),
  exceededCpu: await logCount(stage, window, [
    { key: '$workers.outcome', operation: 'eq', type: 'string', value: 'exceededCpu' },
  ]),
  slowOver3s: await logCount(stage, window, [
    { key: '$workers.wallTimeMs', operation: 'gt', type: 'number', value: 3000 },
  ]),
})

const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

const Rows = Schema.Struct({ data: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) })

export interface ProviderCalls {
  readonly provider: string
  readonly kind: string
  readonly outcome: string
  readonly calls: number
  readonly avgMs: number
  readonly usd: number
}

/** The provider calls Analytics Engine counted for the stage in the window (`kernel/Metrics.ts`). */
export const providerCalls = async (
  dataset: string,
  environment: string,
  window: Window,
): Promise<ReadonlyArray<ProviderCalls>> => {
  const sql = `SELECT blob3 AS provider, blob5 AS kind, blob6 AS outcome, SUM(_sample_interval) AS calls,
      SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_ms, SUM(_sample_interval * double3) / 1000000 AS usd
    FROM ${dataset}
    WHERE index1 LIKE 'call%' AND blob1 = '${environment}'
      AND timestamp >= toDateTime(${seconds(window.from)}) AND timestamp <= toDateTime(${seconds(window.to)})
    GROUP BY provider, kind, outcome ORDER BY provider, kind FORMAT JSON`
  const answer = Schema.decodeUnknownSync(Rows)(await post(`${api}/analytics_engine/sql`, sql, 'text/plain'))
  return answer.data.map((row) => ({
    provider: String(row['provider']),
    kind: String(row['kind']),
    outcome: String(row['outcome']),
    calls: Number(row['calls']),
    avgMs: Number(row['avg_ms']),
    usd: Number(row['usd']),
  }))
}
