import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

// Type sizes, easing curves and durations come from apps/web/src/zyzz.config.ts (DESIGN.md › Type and Motion). zyzz
// already rejects a raw value on a token-mapped property unless it is marked `!custom`; this gate also refuses the
// escape, the animation properties zyzz does not map, and curves written anywhere else.

const root = 'apps/web/src'
const tokenConfig = 'apps/web/src/zyzz.config.ts'

/** The reduced-motion reset ends everything at once; a token cannot carry its `!important`. */
const allowed = new Set(["'0.01ms !important'"])

const rules: ReadonlyArray<Readonly<{ pattern: RegExp; problem: string }>> = [
  { pattern: /fontSize:\s*'[^']*\d[^']*'/, problem: 'a raw font size; use a fontSize token' },
  { pattern: /(?:cubic-bezier|linear)\(/, problem: 'an easing curve; use an ease token' },
  {
    // A token is named by its role; these are CSS's own curves, and `!custom` steps around the tokens.
    pattern:
      /(?:transition|animation)TimingFunction:\s*'(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\(.*|[^']*!custom)'/,
    problem: 'a raw timing function; use an ease token (vars.ease.* where zyzz does not map the property)',
  },
  { pattern: /(?:transition|animation)Duration:\s*'[^']*!custom'/, problem: 'a duration outside the tokens' },
  {
    pattern: /(?:transition|animation)Duration:\s*'[^']*\d+(?:\.\d+)?m?s[^']*'/,
    problem: 'a raw duration; use a transitionDuration token (vars.transitionDuration.* for animations)',
  },
]

const sources = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sources(path)
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : [])
    }),
  )
  return nested.flat()
}

const findings: Array<string> = []
for (const file of await sources(root)) {
  if (relative('.', file) === tokenConfig) continue
  const lines = (await readFile(file, 'utf8')).split('\n')
  lines.forEach((line, index) => {
    if ([...allowed].some((value) => line.includes(value))) return
    for (const { pattern, problem } of rules)
      if (pattern.test(line)) findings.push(`${relative('.', file)}:${index + 1}: ${problem}: ${line.trim()}`)
  })
}

if (findings.length > 0) {
  console.error(findings.join('\n'))
  console.error(`Style tokens: ${findings.length} literal(s) outside ${tokenConfig}`)
  process.exit(1)
}
console.log('Style tokens: type sizes, curves and durations come from the token config')
