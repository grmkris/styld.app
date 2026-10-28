import { expect, test } from 'vitest'
import { assertBrowserSafe, checkDirection } from './graph.ts'
import { importsOf } from './source.ts'

test('import auditing sees re-exports, type imports and dynamic imports without matching strings', () => {
  const source = `export * from '@styld/auth/storage'; import type { A } from './a.ts';
    const text = "import('ignored')"; import('@styld/db'); require('node:fs');`
  expect(importsOf('fixture.ts', source)).toEqual(['@styld/auth/storage', './a.ts', '@styld/db', 'node:fs'])
  expect(() => importsOf('fixture.ts', 'import(userInput)')).toThrow('Computed module import')
})

test('domain cannot depend on persistence and browser cannot reach adapters through re-exports', () => {
  expect(() => checkDirection('@styld/domain', '@styld/db')).toThrow('Forbidden dependency')
  expect(() => checkDirection('@styld/auth', '@styld/server')).toThrow('Forbidden dependency')
  expect(() => checkDirection('@styld/server', '@styld/auth')).not.toThrow()
  for (const file of ['packages/auth/src/storage.ts', 'packages/db/src/index.ts', 'apps/web/src/server/Secret.ts'])
    expect(() => assertBrowserSafe(file, '')).toThrow('Server adapter')
  expect(() => assertBrowserSafe('apps/web/src/entry.ts', 'node:fs')).toThrow('Server adapter')
  expect(() => assertBrowserSafe('packages/auth/src/client.ts', '@yielded/auth/Client')).not.toThrow()
})
