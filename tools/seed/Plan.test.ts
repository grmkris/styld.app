import { readFile } from 'node:fs/promises'
import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { Catalogue, catalogueFaults, manifestIdFor, needsOf, slotOf } from './Catalogue.ts'
import { manifestOf } from './Manifest.ts'
import { onlyBoards, planOf, publishOrder } from './Plan.ts'
import { restOrder } from './Report.ts'

// The seed's plan (owner, 4 November 2026): the catalogue decodes strictly and keeps its rules, its slots resolve to
// manifest specs (shared where neither account's cut differs), and the plan is the same bytes every time, in an order
// that mixes audiences.

const read = async (name: string): Promise<unknown> =>
  parse(await readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8'))
const manifest = manifestOf(await read('manifest.yaml'))
const catalogue = Schema.decodeUnknownSync(Catalogue)(await read('catalogue.yaml'), { onExcessProperty: 'error' })

describe('the catalogue', () => {
  test('the fixture decodes and keeps every rule', () => {
    expect(catalogueFaults(catalogue, manifest)).toEqual([])
  })

  test('a slot names a type, its colours and how many', () => {
    expect(slotOf('shortSleeveTops:white×2')).toEqual({ type: 'shortSleeveTops', colours: ['white'], count: 2 })
    expect(slotOf('scarves:navy:red')).toEqual({ type: 'scarves', colours: ['navy', 'red'], count: 1 })
    expect(() => slotOf('tops:white')).toThrow('Not a garment type')
    expect(() => slotOf('shirts:teal')).toThrow('Not a colour')
  })

  test('a garment with no gendered cut is shared when the other account needs it as often; else it is the account’s', () => {
    const needs = needsOf(catalogue)
    expect(manifestIdFor('women', { type: 'trainers', colours: ['white'] }, 1, needs)).toBe('u-trainers-white')
    expect(manifestIdFor('women', { type: 'trainers', colours: ['white'] }, 2, needs)).toBe('w-trainers-white-2')
    expect(manifestIdFor('men', { type: 'scarves', colours: ['navy', 'red'] }, 1, needs)).toBe('m-scarves-navy-red')
    expect(manifestIdFor('women', { type: 'shirts', colours: ['blue', 'white'] }, 1, needs)).toBe('w-shirts-blue-white')
  })

  test('names every way it breaks a rule', () => {
    const [first] = catalogue.boards
    if (first === undefined) throw new Error('no board')
    const broken = {
      ...catalogue,
      boards: [
        ...catalogue.boards,
        { ...first, pieces: ['coats:pink'] },
        { ...first, id: 'fx-one-piece', template: 'onePiece' as const },
      ],
    }
    expect(catalogueFaults(broken, manifest)).toEqual([
      'fx-black-dress: id used twice',
      'fx-black-dress: w-coats-pink is not in the manifest',
      'fx-one-piece: a one-piece board needs an anchor and a layout holding its outfits',
    ])
  })
})

describe('the plan', () => {
  test('is the same bytes every time, with an operation id per entry', () => {
    const plan = planOf(catalogue, manifest)
    expect(JSON.stringify(planOf(catalogue, manifest))).toBe(JSON.stringify(plan))
    expect(plan.boards.map(({ seedId }) => seedId)).toEqual(['fx-black-dress', 'fx-navy-weekend'])
    expect(new Set(plan.boards.map(({ request }) => request.operationId)).size).toBe(2)
  })

  test('sends each board its manifest ids, its texts with their Slovenian, and its tags', () => {
    const [, men] = planOf(catalogue, manifest).boards
    expect(men?.request.board).toMatchObject({
      build: 'pack',
      pieces: ['m-shirts-blue-white', 'm-jeans-blue', 'm-coats-navy', 'u-trainers-white', 'm-scarves-navy-red'],
      labels: [{ text: '5 pieces for a weekend', style: 'label', sl: '5 kosov za vikend' }],
      sl: { name: 'Temno moder vikend', review: 'pending' },
    })
    expect(men?.request.board.tags).toContainEqual({ kind: 'audience', value: 'men' })
  })

  test('imports into each account only its own garments, a shared one into both', () => {
    const [women, men] = planOf(catalogue, manifest).accounts
    expect(women?.garments).toContain('u-trainers-white')
    expect(men?.garments).toContain('u-trainers-white')
    expect(women?.garments).not.toContain('m-coats-navy')
  })
})

const board = (seedId: string, audience: 'women' | 'men' | 'all', featured = false) => ({
  seedId,
  audience,
  featured,
})

describe('the publish order', () => {
  const boards = [
    board('w1', 'women'),
    board('w2', 'women'),
    board('w3', 'women', true),
    board('m1', 'men'),
    board('a1', 'all'),
    board('m2', 'men', true),
  ]

  test('deals women’s, men’s and everyone’s in turn, the featured last so they are the newest', () => {
    expect(publishOrder(boards).map(({ seedId }) => seedId)).toEqual(['w1', 'm1', 'a1', 'w2', 'w3', 'm2'])
  })

  test('puts a reader’s choice first, then everyone’s, then the rest, each newest first; Everything newest first', () => {
    const published = publishOrder(boards)
    expect(restOrder(published, 'men').map(({ seedId }) => seedId)).toEqual(['m2', 'm1', 'a1', 'w3', 'w2', 'w1'])
    expect(restOrder(published, 'all').map(({ seedId }) => seedId)).toEqual(['m2', 'w3', 'w2', 'a1', 'm1', 'w1'])
  })
})

describe('a sample of the boards', () => {
  test('is the whole plan’s boards it names, with only the garments they show', () => {
    const whole = planOf(catalogue, manifest)
    const sample = onlyBoards(whole, ['fx-navy-weekend'])
    expect(sample.boards).toEqual(whole.boards.filter(({ seedId }) => seedId === 'fx-navy-weekend'))
    const shown = new Set(sample.boards[0]?.request.board.pieces ?? [])
    expect(sample.accounts.flatMap(({ garments }) => garments).every((id) => shown.has(id))).toBe(true)
    expect(sample.accounts.find(({ account }) => account.id === 'women')?.garments).toEqual([])
    expect(() => onlyBoards(whole, ['nowhere'])).toThrow('Not in the catalogue: nowhere')
  })
})
