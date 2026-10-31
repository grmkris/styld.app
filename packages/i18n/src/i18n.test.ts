import { describe, expect, expectTypeOf, test } from 'vitest'

import { catalog as slovenian } from './catalog-sl.ts'
import { direction, format, formatRich, normalizeLocale, text, type MessageValues } from './index.ts'

describe('Styld locales', () => {
  test('formats the reviewed English and Slovenian catalog', () => {
    expect(text('catalog.pieces', { count: 2 })).toBe('2 pieces')
    expect(format('sl', 'catalog.pieces', { count: 2 })).toBe('2 kosa')
  })

  test('Slovenian addresses the person as ti, and never picks a gender for them (DESIGN.md › Copy and chrome)', () => {
    // The forms of vi: its pronouns and verbs, and every imperative ending in -ite or -jte (Vnesite, Počakajte); the
    // words of the catalog that only look like one; and the gendered past (videl_a).
    const formal =
      /(?<!\p{L})(vaš\p{L}*|vam|vami|niste|ste|imate|morate|potrebujete|želite|\p{L}+(?:ite|jte)|\p{L}+_a)(?!\p{L})/giu
    const notImperatives = new Set(['izrazite', 'kredite', 'outfite', 'skrite'])
    const formalIn = (words: string) =>
      [...words.matchAll(formal)].map(([word]) => word).filter((word) => !notImperatives.has(word.toLowerCase()))
    expect(formalIn('Ta koda je potekla. Počakajte minuto in poskusite znova.')).toEqual(['Počakajte', 'poskusite'])
    expect(Object.entries(slovenian).filter(([, words]) => formalIn(words).length > 0)).toEqual([])
  })

  test('keeps locale state explicit and supports pseudolocales', () => {
    expect(normalizeLocale('sl-SI')).toBe('sl')
    expect(normalizeLocale('unknown')).toBe('en')
    expect(direction('ar-XB')).toBe('rtl')
    expect(normalizeLocale('sloppy')).toBe('en')
    expect(format('en-XA', 'catalog.title', {})).toContain('⟦')
    const userValue = '<script>customer</script>'
    expect(format('en-XA', 'catalog.tryOnError', { message: userValue })).toContain(userValue)
    expect(format('ar-XB', 'catalog.title', {})).toContain('\u2067')
  })

  test.each([
    [1, '1 kos'],
    [2, '2 kosa'],
    [3, '3 kosi'],
    [5, '5 kosov'],
    [102, '102 kosa'],
  ])('uses Slovenian plural categories for %s', (count, expected) => {
    expect(format('sl', 'catalog.pieces', { count })).toBe(expected)
  })

  test('interleaves request locales without changing cached formatters', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        const locale = index % 2 === 0 ? 'en' : 'sl'
        await Promise.resolve()
        return format(locale, 'catalog.pieces', { count: 2 })
      }),
    )
    expect(results.every((result, index) => result === (index % 2 === 0 ? '2 pieces' : '2 kosa'))).toBe(true)
  })

  test('rich translations return structured nodes rather than HTML', () => {
    type Node = { tag: 'em'; children: readonly (string | Node)[] }
    const italic = (children: (string | Node)[]): Node => ({ tag: 'em', children })
    expect(formatRich<'outfitCheck.uploadOutfit', Node>('sl', 'outfitCheck.uploadOutfit', { italic })).toEqual([
      'Naloži svoj ',
      { tag: 'em', children: ['videz'] },
    ])
  })

  test('generated contracts require numeric plural counts', () => {
    expectTypeOf<MessageValues<'catalog.pieces'>>().toEqualTypeOf<{ readonly count: number }>()
    expectTypeOf<{ count: string }>().not.toExtend<MessageValues<'catalog.pieces'>>()
    expectTypeOf<{}>().not.toExtend<MessageValues<'catalog.pieces'>>()
  })
})
