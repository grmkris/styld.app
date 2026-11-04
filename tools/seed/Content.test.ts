import { readFile } from 'node:fs/promises'
import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { Catalogue, catalogueFaults } from './Catalogue.ts'
import { manifestOf } from './Manifest.ts'
import { planOf } from './Plan.ts'

// The house boards as the owner wrote them (owner, 4 November 2026: the brief's catalogue and manifest): every rule
// kept, the counts the brief computed, every garment used by some board, and Slovenian that speaks to one person.

const read = async (name: string): Promise<unknown> => parse(await readFile(new URL(name, import.meta.url), 'utf8'))
const manifest = manifestOf(await read('manifest.yaml'))
const catalogue = Schema.decodeUnknownSync(Catalogue)(await read('catalogue.yaml'), { onExcessProperty: 'error' })
const plan = planOf(catalogue, manifest)

const counted = (values: ReadonlyArray<string>): Record<string, number> =>
  Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((v) => v === value).length]))

describe('the house catalogue and manifest', () => {
  test('keep every rule', () => {
    expect(catalogueFaults(catalogue, manifest)).toEqual([])
  })

  test('hold 166 garments, 7 shared, for 173 pieces: 106 women’s and 67 men’s', () => {
    expect(manifest.specs).toHaveLength(166)
    expect(manifest.specs.filter(({ accounts }) => accounts.length === 2)).toHaveLength(7)
    expect(Object.fromEntries(plan.accounts.map(({ account, garments }) => [account.id, garments.length]))).toEqual({
      women: 106,
      men: 67,
    })
  })

  test('hold 53 boards: 26 women’s, 16 men’s and 11 for everyone; 31 on the women’s account and 22 on the men’s', () => {
    expect(catalogue.boards).toHaveLength(53)
    expect(counted(catalogue.boards.map(({ tags }) => tags.audience))).toEqual({ women: 26, men: 16, all: 11 })
    expect(counted(catalogue.boards.map(({ owner }) => owner))).toEqual({ women: 31, men: 22 })
  })

  test('use every garment on some board', () => {
    const used = new Set(plan.accounts.flatMap(({ garments }) => garments))
    expect(manifest.specs.filter(({ id }) => !used.has(id)).map(({ id }) => id)).toEqual([])
  })

  test('feature six boards for each audience, published last', () => {
    const featured = catalogue.boards.filter((board) => board.featured === true)
    expect(counted(featured.map(({ tags }) => tags.audience))).toEqual({ women: 6, men: 6, all: 6 })
    expect(plan.boards.slice(-featured.length).every(({ featured: last }) => last)).toBe(true)
  })

  test('speak Slovenian to one person, never in the plural of politeness or with “(a)”', () => {
    const slovenian = [
      ...catalogue.accounts.flatMap(({ translations }) => [translations.sl.displayName, translations.sl.bio]),
      ...catalogue.boards.flatMap(({ translations }) =>
        [translations.sl.name, translations.sl.label, translations.sl.credit].filter((text) => text !== undefined),
      ),
    ]
    const plural =
      /(?:^|[^\p{L}])(?:vi|vas|vam|vami|vaš|vaša|vaše|vašo|vaših|vašim|ste|boste|imate|morate)(?=$|[^\p{L}])/iu
    expect(slovenian.filter((text) => plural.test(text) || text.includes('(a)'))).toEqual([])
  })
})
