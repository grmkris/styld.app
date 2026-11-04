import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { scriptedWork } from './Fakes.ts'
import { manifestOf, testBatch } from './Manifest.ts'
import { generateAll } from './Garments.ts'
import { dryRunLines, flagsOf, testBatchSpecs } from './Run.ts'

// The operator's run: a dry run is the default and makes no call at all; the test batch draws exactly the ten specs the
// owner chose and nothing else; the cap stops a run cleanly.

const fixture = manifestOf(parse(await readFile(new URL('fixtures/manifest.yaml', import.meta.url), 'utf8')))

describe('the command line', () => {
  test('is a dry run with a $5 cap and Spark unless told otherwise', () => {
    expect(flagsOf(['--manifest', 'm.yaml'])).toEqual({
      mode: 'dry-run',
      manifest: 'm.yaml',
      catalogue: undefined,
      maxUsd: 5,
      judge: 'spark',
      only: [],
      regenerate: [],
      prune: [],
    })
    expect(flagsOf(['--manifest', 'm.yaml', '--test-batch', '--max-usd', '0.5', '--judge', 'clef']).mode).toBe(
      'test-batch',
    )
  })

  test('refuses an unknown flag, two modes, a bad judge or no manifest', () => {
    expect(() => flagsOf(['--manifest', 'm.yaml', '--everything'])).toThrow(/Unknown option '--everything'/u)
    expect(() => flagsOf(['--manifest', 'm.yaml', '--full'])).toThrow('need --catalogue')
    expect(flagsOf(['--manifest', 'm.yaml', '--catalogue', 'c.yaml', '--prune', 'a,b']).prune).toEqual(['a', 'b'])
    expect(() => flagsOf(['--manifest', 'm.yaml', '--dry-run', '--test-batch'])).toThrow('One mode')
    expect(() => flagsOf(['--manifest', 'm.yaml', '--judge', 'gpt'])).toThrow('spark or clef')
    expect(() => flagsOf([])).toThrow('Usage')
  })
})

describe('the dry run', () => {
  test('counts specs and pieces per account and what is left to pay for', () => {
    const lines = dryRunLines(fixture, new Set(['u-trainers-white']), flagsOf(['--manifest', 'm.yaml']))
    expect(lines[0]).toBe('Manifest: 10 specs (1 shared) → pieces: women 6, men 5')
    expect(lines[1]).toBe('Cached passing pictures: 1 of 10')
    expect(lines).toContain('  ✔ u-trainers-white')
    expect(lines).toContain('  ✘ m-coats-navy')
  })
})

describe('the test batch', () => {
  test('draws exactly the ten specs, in order, and nothing else', async () => {
    const { work, prompts } = scriptedWork()
    const records = await generateAll(testBatchSpecs(fixture, []), work, [])
    expect(records.map(({ spec }) => spec.id)).toEqual([...testBatch])
    expect(prompts).toHaveLength(10)
  })

  test('a batch of named garments takes them from the whole manifest, and refuses a name it lacks', () => {
    expect(testBatchSpecs(fixture, ['w-bags-brown', 'm-coats-navy']).map(({ id }) => id)).toEqual([
      'w-bags-brown',
      'm-coats-navy',
    ])
    expect(() => testBatchSpecs(fixture, ['nowhere'])).toThrow('The manifest lacks specs: nowhere')
  })

  test('stops cleanly at the cap, drawing nothing past it', async () => {
    const { work, prompts } = scriptedWork(new Map(), 0.05)
    const records = await generateAll(testBatchSpecs(fixture, []), work, [])
    expect(prompts.length).toBeLessThan(10)
    expect(work.ledger.total()).toBeLessThanOrEqual(50_000)
    expect(records.every(({ record }) => record.status === 'passed')).toBe(true)
  })
})
