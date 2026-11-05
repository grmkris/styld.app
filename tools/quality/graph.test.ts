import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { allowedCycles, areaOf, assertBrowserSafe, checkDirection, checkGraph, serverLayerBreaches } from './graph.ts'
import { importsOf, sourceFiles, valueImportsOf } from './source.ts'

const withSources = async <A>(sources: Record<string, string>, run: (root: string) => Promise<A>) => {
  const root = await mkdtemp(join(tmpdir(), 'styld-graph-'))
  try {
    for (const [file, contents] of Object.entries({
      'apps/web/package.json': JSON.stringify({ name: '@styld/web' }),
      ...sources,
    })) {
      const path = join(root, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents)
    }
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('import auditing sees re-exports, type imports and dynamic imports without matching strings', () => {
  const source = `export * from '@styld/auth/storage'; import type { A } from './a.ts';
    const text = "import('ignored')"; import('@styld/db'); require('node:fs'); import fs = require('fs');`
  expect(importsOf('fixture.ts', source)).toEqual(['@styld/auth/storage', './a.ts', '@styld/db', 'node:fs', 'fs'])
  expect(() => importsOf('fixture.ts', 'import(userInput)')).toThrow('Computed module import')
})

test('domain cannot depend on persistence and browser cannot reach adapters through re-exports', () => {
  expect(() => checkDirection('@styld/domain', '@styld/db')).toThrow('Forbidden dependency')
  expect(() => checkDirection('@styld/auth', '@styld/server')).toThrow('Forbidden dependency')
  expect(() => checkDirection('@styld/server', '@styld/auth')).not.toThrow()
  expect(() => checkDirection('@styld/auth', '@styld/i18n')).not.toThrow()
  expect(() => checkDirection('@styld/i18n', '@styld/auth')).toThrow('Forbidden dependency')
  // The shared contracts stay browser-safe: they may use auth's contract, never server code.
  expect(() => checkDirection('@styld/protocol', '@styld/auth')).not.toThrow()
  expect(() => checkDirection('@styld/protocol', '@styld/server')).toThrow('Forbidden dependency')
  expect(() => checkDirection('@styld/web', '@styld/protocol')).not.toThrow()
  for (const file of [
    'packages/auth/src/storage.ts',
    'packages/auth/src/EmailEntry.ts',
    'packages/db/src/index.ts',
    'apps/web/src/server/Secret.ts',
  ])
    expect(() => assertBrowserSafe(file, '')).toThrow('Server adapter')
  expect(() => assertBrowserSafe('apps/web/src/entry.ts', 'node:fs')).toThrow('Server adapter')
  expect(() => assertBrowserSafe('packages/auth/src/client.ts', '@yielded/auth/Client')).not.toThrow()
  expect(() => assertBrowserSafe('packages/auth/src/EmailEntryContract.ts', '@yielded/auth')).not.toThrow()
})

test.each(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])(
  'audits and rejects a server import behind a %s re-export',
  async (extension) => {
    await withSources(
      {
        'apps/web/src/entry.ts': `import './bridge.${extension}'`,
        [`apps/web/src/bridge.${extension}`]:
          extension === 'cjs' ? "module.exports = require('./server/Secret.ts')" : "export * from './server/Secret.ts'",
        'apps/web/src/server/Secret.ts': 'export const secret = 1',
      },
      async (root) => {
        expect(await sourceFiles(root)).toHaveLength(3)
        await expect(checkGraph(root)).rejects.toThrow('Server adapter in browser graph')
      },
    )
  },
)

test.each(['fs', 'fs/promises', 'node:fs', 'bun:sqlite'])(
  'rejects the server runtime import %s through a JavaScript bridge',
  async (specifier) => {
    await withSources(
      {
        'apps/web/src/entry.ts': "import './bridge.js'",
        'apps/web/src/bridge.js': `import '${specifier}'`,
      },
      async (root) => {
        await expect(checkGraph(root)).rejects.toThrow('Server adapter in browser graph')
      },
    )
  },
)

test('resolves extensionless barrels and TypeScript implementations of JavaScript imports', async () => {
  await withSources(
    {
      'apps/web/src/entry.ts': "import './barrel'",
      'apps/web/src/barrel/index.ts': "export * from '../safe.js'",
      'apps/web/src/safe.ts': 'export const value = 1',
    },
    async (root) => {
      expect(await checkGraph(root)).toEqual({ files: 3, browserModules: 3 })
    },
  )
})

test('fails closed on an unresolved browser source', async () => {
  await withSources({ 'apps/web/src/entry.ts': "import './missing.js'" }, async (root) => {
    await expect(checkGraph(root)).rejects.toThrow('Unresolved source import')
  })
})

test.each([
  { imported: 'mjs', source: 'mts' },
  { imported: 'cjs', source: 'cts' },
])('follows the $source implementation of a $imported import', async ({ imported, source }) => {
  await withSources(
    {
      'apps/web/src/entry.ts': `import './bridge.${imported}'`,
      'apps/web/src/bridge.ts': 'export const safe = 1',
      [`apps/web/src/bridge.${source}`]: "import fs = require('fs')",
    },
    async (root) => {
      await expect(checkGraph(root)).rejects.toThrow('Server adapter in browser graph')
    },
  )
})

test('requires explicit imports when source resolution would be ambiguous', async () => {
  await withSources(
    {
      'apps/web/src/entry.ts': "import './bridge'",
      'apps/web/src/bridge.ts': 'export const value = 1',
      'apps/web/src/bridge.js': "import 'fs'",
    },
    async (root) => {
      await expect(checkGraph(root)).rejects.toThrow('Ambiguous source import')
    },
  )
})

const layered = (imports: Record<string, ReadonlyArray<string>>, allowed: typeof allowedCycles = []) =>
  serverLayerBreaches(new Map(Object.entries(imports)), allowed)

test('server areas are folders, the provider seam, or files at the top', () => {
  expect(areaOf('wardrobe/Store.ts')).toBe('wardrobe/')
  expect(areaOf('Config.ts')).toBe('Config.ts')
  expect(areaOf('providers/Errors.ts')).toBe('providers/ (seam)')
  expect(areaOf('ai/LanguageModel.ts')).toBe('providers/ (seam)')
  expect(areaOf('providers/Meta.ts')).toBe('providers/')
})

test('the server layers: the bottom and the provider seam look down only, domain modules never reach a surface', () => {
  expect(layered({ 'kernel/Db.ts': ['wardrobe/Store.ts'] })).toEqual([
    'kernel/Db.ts -> wardrobe/Store.ts: the bottom imports nothing above it',
  ])
  expect(layered({ 'providers/Call.ts': ['capture/Providers.ts'] })).toEqual([
    'providers/Call.ts -> capture/Providers.ts: the provider seam imports only the bottom and itself',
  ])
  expect(layered({ 'links/Links.ts': ['mcp/Route.ts'], 'photos/Photos.ts': ['tools/Tools.ts'] })).toEqual([
    'links/Links.ts -> mcp/Route.ts: a domain module never imports a surface',
    'photos/Photos.ts -> tools/Tools.ts: a domain module never imports a surface',
  ])
  expect(layered({ 'stylist/Catalogue.ts': ['mcp/Route.ts'] })).toEqual([
    'stylist/Catalogue.ts -> mcp/Route.ts: only the MCP transport is in mcp/',
  ])
  // Adapters implement the ports domain modules declare; modules use the seam.
  expect(
    layered({
      'providers/Meta.ts': ['capture/Providers.ts', 'providers/Http.ts'],
      'capture/Drawing.ts': ['providers/Errors.ts', 'kernel/Db.ts'],
      'tools/WardrobeTools.ts': ['wardrobe/Wardrobe.ts'],
    }),
  ).toEqual([])
})

test('two areas that import each other fail unless allowed, and an allowed pair that is no cycle any more fails', () => {
  const cycle = { 'boards/Boards.ts': ['social/Public.ts'], 'social/Public.ts': ['boards/Shared.ts'] }
  expect(layered(cycle)).toEqual(['boards/ <-> social/: two areas import each other; break the cycle'])
  expect(layered(cycle, [['social/', 'boards/', 'kept']])).toEqual([])
  expect(layered({ 'boards/Boards.ts': ['social/Public.ts'] }, [['boards/', 'social/', 'kept']])).toEqual([
    'boards/ <-> social/: no longer a cycle; take it off allowedCycles',
  ])
})

test('only what runs is an import between layers: type-only imports and re-exports leave nothing', () => {
  const source = `import type { A } from './a.ts'; import { type B } from './b.ts'; import { C, type D } from './c.ts'
    export type { E } from './e.ts'; export { F } from './f.ts'; const g = import('./g.ts')`
  expect(valueImportsOf('fixture.ts', source)).toEqual(['./c.ts', './f.ts', './g.ts'])
})

test('every allowed cycle says why it is still there', () => {
  for (const [, , why] of allowedCycles) expect(why.length).toBeGreaterThan(20)
})
