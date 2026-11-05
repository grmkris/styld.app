/**
 * Before and after: two measurements (`Run.ts`) of releases A and B, side by side, with the debt census of each
 * release's commit (taken in a temporary detached worktree with today's census rules, so the two are counted alike)
 * and the behaviour diff of the answers each run kept.
 *
 *   bun tools/measure/Report.ts <releaseA> <releaseB> [--html <file>]
 *
 * Reads `STYLD_MEASURE_OUT` (default `~/private/styld-research/measure`). Prints Markdown; `--html` also writes a page
 * (publish it on the tailnet with `preview <file> --name styld-fixes-report`).
 */
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { escapeHtml } from '@styld/protocol/html'
import { headline, metricNames } from '../quality/census.ts'

const [a, b] = process.argv.slice(2)
if (a === undefined || b === undefined) throw new Error('Usage: bun tools/measure/Report.ts <releaseA> <releaseB>')
const out = process.env['STYLD_MEASURE_OUT'] ?? join(homedir(), 'private/styld-research/measure')
const repo = new URL('../..', import.meta.url).pathname

const Timing = Schema.Struct({
  status: Schema.Number,
  bytes: Schema.Number,
  cold: Schema.Number,
  p50: Schema.Number,
  p95: Schema.Number,
})
type Timing = typeof Timing.Type
const PageReading = Schema.Struct({ ttfb: Schema.Number, lcp: Schema.Number, cls: Schema.Number, load: Schema.Number })
type PageReading = typeof PageReading.Type
const Row = Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String]))
const Run = Schema.Struct({
  release: Schema.String,
  api: Schema.Record(Schema.String, Timing),
  tools: Schema.Record(Schema.String, Timing),
  pages: Schema.Record(Schema.String, Schema.Array(PageReading)),
  workers: Schema.Array(Row),
  logs: Schema.Record(Schema.String, Schema.Number),
  providers: Schema.Array(Row),
})
type Run = typeof Run.Type
const Counted = Schema.Struct({ census: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)) })

const load = async (release: string): Promise<Run> =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Run))(await readFile(join(out, release, 'run.json'), 'utf8'))

const git = (args: ReadonlyArray<string>, cwd = repo) => {
  const result = Bun.spawnSync(['git', ...args], { cwd })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

/** The census of a commit, counted by today's rules in a throwaway detached worktree. */
const censusAt = async (release: string): Promise<Record<string, number>> => {
  const tree = `/tmp/styld-census-${release.slice(0, 12)}`
  await rm(tree, { recursive: true, force: true })
  git(['worktree', 'add', '--detach', '--quiet', tree, release])
  try {
    const counted = Bun.spawnSync(['bun', join(repo, 'tools/debt-check.ts'), '--json'], { cwd: tree })
    if (counted.exitCode !== 0) throw new Error(`census at ${release}: ${counted.stderr.toString()}`)
    const { census } = Schema.decodeUnknownSync(Schema.fromJsonString(Counted))(counted.stdout.toString())
    return Object.fromEntries(metricNames.map((metric) => [metric, headline(metric, census[metric])]))
  } finally {
    git(['worktree', 'remove', '--force', tree])
  }
}

const ms = (value: number) => `${Math.round(value)}`
const change = (before: number, after: number) => {
  if (before === 0) return after === 0 ? '0' : `+${after}`
  const percent = Math.round(((after - before) / before) * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}
const median = (values: ReadonlyArray<number>) => values.toSorted((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0

const table = (head: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

/** Answers that differ between the runs, by file. */
const answerDiff = async (): Promise<ReadonlyArray<string>> => {
  const names = new Set([
    ...(await readdir(join(out, a, 'answers')).catch(() => [])),
    ...(await readdir(join(out, b, 'answers')).catch(() => [])),
  ])
  const differing: string[] = []
  for (const name of [...names].toSorted()) {
    const before = await readFile(join(out, a, 'answers', name), 'utf8').catch(() => 'missing')
    const after = await readFile(join(out, b, 'answers', name), 'utf8').catch(() => 'missing')
    if (before !== after) differing.push(name)
  }
  return differing
}

const [before, after] = [await load(a), await load(b)]
const [censusBefore, censusAfter] = [await censusAt(before.release), await censusAt(after.release)]
const timingRows = (pick: (run: Run) => Readonly<Record<string, Timing>>) =>
  Object.keys(pick(after)).map((name) => {
    const x = pick(before)[name]
    const y = pick(after)[name]
    return [
      name,
      x === undefined ? '–' : `${ms(x.cold)} / ${ms(x.p50)} / ${ms(x.p95)}`,
      y === undefined ? '–' : `${ms(y.cold)} / ${ms(y.p50)} / ${ms(y.p95)}`,
      x === undefined || y === undefined ? '–' : change(x.p50, y.p50),
      `${x?.status ?? '–'} → ${y?.status ?? '–'}`,
    ]
  })
const pick = (readings: ReadonlyArray<PageReading>, key: keyof PageReading) => median(readings.map((r) => r[key]))
const pageRow = (name: string) => {
  const x = before.pages[name] ?? []
  const y = after.pages[name] ?? []
  return [
    name,
    `${ms(pick(x, 'ttfb'))} / ${ms(pick(x, 'lcp'))} / ${pick(x, 'cls').toFixed(3)}`,
    `${ms(pick(y, 'ttfb'))} / ${ms(pick(y, 'lcp'))} / ${pick(y, 'cls').toFixed(3)}`,
    change(pick(x, 'lcp'), pick(y, 'lcp')),
  ]
}
const workerRow = (role: string) => {
  const x = before.workers.find((w) => w['role'] === role)
  const y = after.workers.find((w) => w['role'] === role)
  const cell = (w: typeof x) =>
    w === undefined
      ? '–'
      : `${w['requests']} req, ${w['errors']} err, CPU ${w['cpuP50']}/${w['cpuP99']} ms, wall p99 ${Math.round(Number(w['wallP99']))} ms`
  return [role, cell(x), cell(y)]
}
const differing = await answerDiff()

const markdown = [
  `# Styld measurement: ${a.slice(0, 8)} → ${b.slice(0, 8)}`,
  '',
  '## Debt census (lower is better)',
  table(
    ['count', a.slice(0, 8), b.slice(0, 8), 'change'],
    metricNames.map((metric) => [
      metric,
      String(censusBefore[metric] ?? 0),
      String(censusAfter[metric] ?? 0),
      change(censusBefore[metric] ?? 0, censusAfter[metric] ?? 0),
    ]),
  ),
  '',
  '## API reads, signed in (ms: cold / warm p50 / warm p95)',
  table(
    ['read', a.slice(0, 8), b.slice(0, 8), 'p50', 'status'],
    timingRows((run) => run.api),
  ),
  '',
  '## MCP tools (ms: cold / warm p50 / warm p95)',
  table(
    ['tool', a.slice(0, 8), b.slice(0, 8), 'p50', 'status'],
    timingRows((run) => run.tools),
  ),
  '',
  '## Pages on a phone (median ms TTFB / LCP, CLS)',
  table(['page', a.slice(0, 8), b.slice(0, 8), 'LCP'], Object.keys(after.pages).map(pageRow)),
  '',
  '## Workers in the window (Cloudflare analytics)',
  table(['worker', a.slice(0, 8), b.slice(0, 8)], ['edge', 'website', 'api', 'stylist'].map(workerRow)),
  '',
  '## Workers Logs in the window',
  table(
    ['events', a.slice(0, 8), b.slice(0, 8)],
    Object.keys(after.logs).map((key) => [key, String(before.logs[key] ?? 0), String(after.logs[key] ?? 0)]),
  ),
  '',
  '## Provider calls in the window',
  table(
    ['run', 'provider', 'kind', 'outcome', 'calls', 'avg ms', 'USD'],
    [
      ...before.providers.map((p) => [
        'before',
        ...['provider', 'kind', 'outcome', 'calls', 'avgMs', 'usd'].map((k) => String(p[k])),
      ]),
      ...after.providers.map((p) => [
        'after',
        ...['provider', 'kind', 'outcome', 'calls', 'avgMs', 'usd'].map((k) => String(p[k])),
      ]),
    ],
  ),
  '',
  '## Behaviour: answers that differ',
  differing.length === 0 ? 'None: every kept answer is the same.' : differing.map((name) => `- ${name}`).join('\n'),
  '',
].join('\n')

console.log(markdown)
const htmlAt = process.argv.indexOf('--html')
if (htmlAt > 0) {
  const file = process.argv[htmlAt + 1] ?? 'report.html'
  await writeFile(
    file,
    `<meta charset="utf-8"><title>Styld measurement</title><pre style="font: 14px/1.5 ui-monospace, monospace; padding: 1rem; white-space: pre-wrap">${escapeHtml(markdown)}</pre>`,
  )
}
