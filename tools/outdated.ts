/**
 * What the pins are behind: every exact version the workspace installs (each package.json, the catalog, the overrides
 * and Bun itself) against the npm registry, and the tsrs-lint release (tools/tsrs-lint.ts) against its repository's
 * releases. A report for whoever upgrades, run by hand; it is not part of `check`, because a release upstream must not
 * turn main red.
 *
 *   bun run deps:outdated            prints every pin that is behind; exits 0
 *   bun run deps:outdated --strict   exits 1 when a pin that is not held is behind
 *
 * A pin is compared within its channel, unlike `bun outdated`, which reads only the `latest` tag: a stable pin against
 * stable releases, `0.1.0-beta.47` against later betas and stable releases even when `latest` names an older beta, and
 * never against a commit-tagged canary such as `0.169.0-canary.90746b32d2ca`. `held` keeps a pin on one major on
 * purpose, with the reason; a held pin is still reported when its own major moves on.
 */
import { Schema } from 'effect'
import { readFile } from 'node:fs/promises'
import { TSRS_LINT } from './tsrs-lint.ts'

/** Pins kept on one major on purpose. */
export const held: Readonly<Record<string, { readonly major: number; readonly reason: string }>> = {
  '@types/node': { major: 24, reason: 'Node 24 LTS runs the tools on the box and in CI' },
}

const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u

interface Version {
  readonly core: readonly [number, number, number]
  readonly prerelease: ReadonlyArray<string>
}

const parse = (version: string): Version | undefined => {
  const match = versionPattern.exec(version)
  if (match === null) return undefined
  const [, major = '', minor = '', patch = '', prerelease] = match
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

const numeric = /^\d+$/u

/** A prerelease's channel: its identifiers without the numeric ones, so `beta.85` and `beta.86` share `beta`, while
 * `canary.90746b32d2ca` is a channel of one. A stable version's channel is empty. */
export const channelOf = (version: string): string | undefined =>
  parse(version)
    ?.prerelease.filter((identifier) => !numeric.test(identifier))
    .join('.')

const compareIdentifiers = (left: string, right: string): number => {
  const leftNumeric = numeric.test(left)
  const rightNumeric = numeric.test(right)
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right))
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Semantic-version precedence of two parsed versions: the core, then a stable release above its prereleases, then the
 * prerelease identifiers in order. */
const compareParsed = (left: Version, right: Version): number => {
  for (const index of [0, 1, 2] as const) {
    const difference = Math.sign(left.core[index] - right.core[index])
    if (difference !== 0) return difference
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0)
    return Math.sign(right.prerelease.length - left.prerelease.length)
  for (const [index, identifier] of left.prerelease.entries()) {
    const other = right.prerelease[index]
    if (other === undefined) return 1
    const difference = compareIdentifiers(identifier, other)
    if (difference !== 0) return difference
  }
  return left.prerelease.length < right.prerelease.length ? -1 : 0
}

/** The newest published version a pin could move to: later than it, in its channel or stable, and on the held major
 * when the pin is held. Undefined when the pin is current or is not a plain version. */
export const newestFor = (current: string, published: ReadonlyArray<string>, major?: number): string | undefined => {
  const pinned = parse(current)
  const channel = channelOf(current)
  if (pinned === undefined) return undefined
  const newer = published.flatMap((version) => {
    const candidate = parse(version)
    if (candidate === undefined || compareParsed(candidate, pinned) <= 0) return []
    if (major !== undefined && candidate.core[0] !== major) return []
    const candidateChannel = channelOf(version)
    return candidateChannel === '' || candidateChannel === channel ? [{ version, candidate }] : []
  })
  return newer.toSorted((left, right) => compareParsed(left.candidate, right.candidate)).at(-1)?.version
}

const Versions = Schema.Record(Schema.String, Schema.String)
const Manifest = Schema.Struct({
  dependencies: Schema.optional(Versions),
  devDependencies: Schema.optional(Versions),
  optionalDependencies: Schema.optional(Versions),
  overrides: Schema.optional(Versions),
  packageManager: Schema.optional(Schema.String),
  workspaces: Schema.optional(
    Schema.Struct({ packages: Schema.Array(Schema.String), catalog: Schema.optional(Versions) }),
  ),
})
const Packument = Schema.Struct({ versions: Schema.Record(Schema.String, Schema.Unknown) })
const Releases = Schema.Array(
  Schema.Struct({ tag_name: Schema.String, published_at: Schema.String, draft: Schema.Boolean }),
)

interface Pin {
  readonly name: string
  readonly version: string
  readonly where: ReadonlyArray<string>
}

const root = `${import.meta.dir}/..`
const readManifest = async (file: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(await readFile(file, 'utf8'))

/** Every exact version installed by name: catalog references resolve to the catalog's pin, workspace links are not
 * pins, and Bun's own version comes from `packageManager`. */
const collectPins = async (): Promise<ReadonlyArray<Pin>> => {
  const rootManifest = await readManifest(`${root}/package.json`)
  const catalog = rootManifest.workspaces?.catalog ?? {}
  const workspaceFiles = await Array.fromAsync(
    new Bun.Glob(`{${(rootManifest.workspaces?.packages ?? []).join(',')}}/package.json`).scan({ cwd: root }),
  )
  const sources = [
    { where: 'package.json', manifest: rootManifest },
    ...(await Promise.all(
      workspaceFiles.toSorted().map(async (file) => ({
        where: file.replace(/\/package\.json$/u, ''),
        manifest: await readManifest(`${root}/${file}`),
      })),
    )),
  ]
  const pins = new Map<string, { name: string; version: string; where: Array<string> }>()
  const add = (name: string, version: string, where: string) => {
    if (parse(version) === undefined) return
    const key = `${name}@${version}`
    const pin = pins.get(key) ?? { name, version, where: [] }
    if (!pin.where.includes(where)) pin.where.push(where)
    pins.set(key, pin)
  }
  for (const [name, version] of Object.entries(catalog)) add(name, version, 'catalog')
  for (const [name, version] of Object.entries(rootManifest.overrides ?? {})) add(name, version, 'overrides')
  const [, bunVersion] = /^bun@(.+)$/u.exec(rootManifest.packageManager ?? '') ?? []
  if (bunVersion !== undefined) add('bun', bunVersion, 'packageManager')
  for (const { where, manifest } of sources) {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }
    for (const [name, specifier] of Object.entries(declared)) {
      if (specifier.startsWith('catalog:') || specifier.startsWith('workspace:')) continue
      add(name, specifier, where)
    }
  }
  return [...pins.values()].toSorted((left, right) => (left.name < right.name ? -1 : 1))
}

const published = async (name: string): Promise<ReadonlyArray<string>> => {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (!response.ok) throw new Error(`npm registry: ${name} answered ${response.status}`)
  return Object.keys(Schema.decodeUnknownSync(Packument)(await response.json()).versions)
}

/** The newest tsrs-lint release of the pinned repository, when it is not the pinned tag. */
const newerLintRelease = async (): Promise<string | undefined> => {
  const response = await fetch(`https://api.github.com/repos/${TSRS_LINT.repository}/releases?per_page=30`, {
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub: ${TSRS_LINT.repository} releases answered ${response.status}`)
  const newest = Schema.decodeUnknownSync(Releases)(await response.json())
    .filter((release) => !release.draft && release.tag_name.startsWith('lint-'))
    .toSorted((left, right) => (left.published_at < right.published_at ? 1 : -1))
    .at(0)
  return newest === undefined || newest.tag_name === TSRS_LINT.tag ? undefined : newest.tag_name
}

const report = async (strict: boolean) => {
  const pins = await collectPins()
  const [rows, lint] = await Promise.all([
    Promise.all(
      pins.map(async (pin) => {
        const versions = await published(pin.name)
        const hold = held[pin.name]
        return {
          pin,
          hold,
          inLine: newestFor(pin.version, versions, hold?.major),
          beyond: hold === undefined ? undefined : newestFor(pin.version, versions),
        }
      }),
    ),
    newerLintRelease(),
  ])
  const width = Math.max(...pins.map((pin) => pin.name.length))
  const behind = rows.filter((row) => row.inLine !== undefined)
  for (const { pin, inLine } of behind)
    console.log(`behind  ${pin.name.padEnd(width)}  ${pin.version} → ${inLine}  (${pin.where.join(', ')})`)
  if (lint !== undefined)
    console.log(`behind  ${'tsrs-lint'.padEnd(width)}  ${TSRS_LINT.tag} → ${lint}  (tools/tsrs-lint.ts)`)
  for (const { pin, hold, beyond } of rows)
    if (hold !== undefined && beyond !== undefined)
      console.log(`held    ${pin.name.padEnd(width)}  ${pin.version}, ${beyond} out: ${hold.reason}`)
  const count = behind.length + (lint === undefined ? 0 : 1)
  console.log(`deps:outdated: ${pins.length + 1} pins, ${count} behind`)
  if (strict && count > 0) process.exitCode = 1
}

if (import.meta.main) await report(process.argv.includes('--strict'))
