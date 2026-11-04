import {
  type Colour,
  type OutfitBrief,
  outfitKeyOf,
  type OutfitProposal,
  PieceId,
  type PieceType,
  slotOf,
} from '@styld/protocol'
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { distinct } from '../src/outfits/Outfits.ts'
import { keptProposals, proposalMessages, sentFrom } from '../src/outfits/Proposer.ts'
import { type Brief, missingOf, proposed, validated, type Wearable } from '../src/outfits/Rules.ts'

let pieces = 0
/** A ready piece of a type, plain unless its colours or pattern say otherwise. */
const piece = (type: PieceType, details: Partial<Omit<Wearable, 'id' | 'type'>> = {}): Wearable => {
  pieces += 1
  return {
    id: PieceId.make(`pc_${String(pieces).padStart(22, '0')}`),
    type,
    colours: ['navy'],
    seasons: [],
    rainproof: false,
    occasions: [],
    pattern: 'plain',
    name: null,
    drawn: false,
    ...details,
  }
}

const brief = (wardrobe: ReadonlyArray<Wearable>, rest: Partial<Omit<Brief, 'wardrobe'>> = {}): Brief => ({
  wardrobe,
  fixed: [],
  brief: {},
  seen: new Set(),
  ...rest,
})

const loud = (colour: Colour) => ({ colours: [colour] as const })

const tee = piece('shortSleeveTops')
const shirt = piece('shirts', loud('red'))
const knit = piece('knitwear', { seasons: ['autumn', 'winter'] })
const jeans = piece('jeans')
const skirt = piece('skirts', loud('yellow'))
const shorts = piece('shorts', { seasons: ['summer'] })
const dress = piece('dresses', { pattern: 'printed' })
const trainers = piece('trainers')
const sandals = piece('sandals', { seasons: ['spring', 'summer'] })
const coat = piece('coats', { seasons: ['autumn', 'winter'] })
const bag = piece('bags')
const leggings = piece('sportswear', { occasions: ['sport'] })
const wardrobe = [tee, shirt, knit, jeans, skirt, shorts, dress, trainers, sandals, coat, bag, leggings]

/** Every outfit the rules draw for a request over many seeds. */
const drawnOver = (request: Brief) =>
  Array.from({ length: 12 }, (_, seed) => proposed(request, String(seed), 12).outfits).flat()

const slotsOf = (outfit: ReadonlyArray<Wearable>) => outfit.map(({ type }) => slotOf(type))
const shoesOf = (outfit: ReadonlyArray<Wearable>) => outfit.filter(({ type }) => slotOf(type) === 'shoes')

describe('the outfit rules', () => {
  test('every drawn outfit stands on a top and a bottom or a one-piece, has shoes, one of each, one statement', () => {
    const outfits = drawnOver(brief(wardrobe))
    expect(outfits.length).toBeGreaterThan(20)
    for (const outfit of outfits) {
      const slots = slotsOf(outfit)
      const separates = slots.includes('top') && slots.includes('bottom') && !slots.includes('onePiece')
      const onePiece = slots.includes('onePiece') && !slots.includes('top') && !slots.includes('bottom')
      expect(separates || onePiece).toBe(true)
      expect(slots.filter((slot) => slot === 'shoes')).toHaveLength(1)
      expect(slots).not.toContain('set')
      for (const slot of ['bottom', 'onePiece', 'layer', 'shoes'] as const)
        expect(slots.filter((one) => one === slot).length).toBeLessThanOrEqual(1)
      // Two tops only as the knit over something lighter.
      const tops = outfit.filter(({ type }) => slotOf(type) === 'top')
      expect(tops.length <= 1 || (tops.length === 2 && tops.includes(knit))).toBe(true)
      const statements = outfit.filter(
        ({ colours, pattern }) => colours.some((colour) => colour !== 'navy') || pattern === 'printed',
      )
      expect(statements.length).toBeLessThanOrEqual(1)
      expect(
        Option.isSome(
          validated(
            brief(wardrobe),
            outfit.map(({ id }) => id),
          ),
        ),
      ).toBe(true)
    }
  })

  test('the anchor and the locked pieces are in every outfit, and its shape follows the anchor', () => {
    const request = brief(wardrobe, { fixed: [skirt, bag] })
    const outfits = drawnOver(request)
    expect(outfits.length).toBeGreaterThan(0)
    for (const outfit of outfits) {
      expect(outfit).toContain(skirt)
      expect(outfit).toContain(bag)
      // The skirt is the one statement: the red shirt never joins it.
      expect(outfit).not.toContain(shirt)
      expect(slotsOf(outfit)).not.toContain('onePiece')
    }
  })

  test('a piece with no season is worn in any; one in some is worn only in those (T-12)', () => {
    const allYear = piece('shortSleeveTops', { name: 'Grey tee' })
    const springTop = piece('shortSleeveTops', { seasons: ['spring'] })
    const tops = [allYear, springTop, jeans, trainers]
    for (const outfit of drawnOver(brief(tops, { brief: { season: 'winter' } })))
      expect(outfit).not.toContain(springTop)
    expect(drawnOver(brief(tops, { brief: { season: 'winter' } })).some((outfit) => outfit.includes(allYear))).toBe(
      true,
    )
    expect(drawnOver(brief(tops, { brief: { season: 'spring' } })).some((outfit) => outfit.includes(springTop))).toBe(
      true,
    )
  })

  test('sport shoes go with sport only, everyday trainers with anything (T-12)', () => {
    const runners = piece('sportShoes')
    const hikers = piece('outdoorShoes')
    const shod = [...wardrobe, runners, hikers]
    for (const outfit of drawnOver(brief(shod, { brief: { occasion: 'casual' } }))) {
      expect(outfit).not.toContain(runners)
      expect(outfit).not.toContain(hikers)
    }
    const sporty = drawnOver(brief(shod, { brief: { occasion: 'sport' } }))
    expect(sporty.some((outfit) => outfit.includes(runners) || outfit.includes(hikers))).toBe(true)
  })

  test('an outfit always wears shoes: the pairs that suit first, then other everyday ones, sport shoes last (Eva)', () => {
    const runners = piece('sportShoes')
    const winterBoots = piece('boots', { seasons: ['winter'] })
    const summerSandals = piece('sandals', { seasons: ['summer'] })
    const loafers = piece('flats', { seasons: ['spring', 'autumn'], occasions: ['smart'] })
    const base = [tee, jeans, knit]
    // Suiting shoes first: in winter only the boots.
    const winter = drawnOver(brief([...base, runners, winterBoots, summerSandals], { brief: { season: 'winter' } }))
    expect(winter.length).toBeGreaterThan(0)
    for (const outfit of winter) expect(shoesOf(outfit)).toEqual([winterBoots])
    // None suits a formal summer evening: any everyday pair, never the running shoes.
    for (const complete of [false, true]) {
      const evening = brief([...base, runners, winterBoots, loafers], {
        brief: { season: 'summer', occasion: 'formal' },
        complete,
      })
      const outfits = drawnOver(evening)
      expect(outfits.length).toBeGreaterThan(0)
      for (const outfit of outfits) {
        expect(shoesOf(outfit)).toHaveLength(1)
        expect(shoesOf(outfit)).not.toContain(runners)
      }
      expect(new Set(outfits.flatMap(shoesOf))).toEqual(new Set([winterBoots, loafers]))
      expect(missingOf(evening)).toEqual([])
    }
    // Running shoes only when they are the only pair the wardrobe holds.
    for (const outfit of drawnOver(brief([...base, runners], { brief: { occasion: 'formal' }, complete: true })))
      expect(shoesOf(outfit)).toEqual([runners])
  })

  test('nothing for the other season while something suits, and a set only for sport', () => {
    for (const outfit of drawnOver(brief(wardrobe, { brief: { season: 'summer' } }))) {
      expect(outfit).not.toContain(knit)
      expect(outfit).not.toContain(coat)
    }
    for (const outfit of drawnOver(brief(wardrobe, { brief: { season: 'winter' } }))) {
      expect(outfit).not.toContain(shorts)
      expect(outfit).not.toContain(sandals)
    }
    const sporty: OutfitBrief = { occasion: 'sport' }
    expect(drawnOver(brief(wardrobe, { brief: sporty })).some((outfit) => outfit.includes(leggings))).toBe(true)
  })

  test('the combinations already shown never come back, and the draws say when the rules have run out', () => {
    const small = [tee, jeans, trainers]
    const first = proposed(brief(small), 'a', 6)
    expect(first.outfits.map((outfit) => outfit.map(({ id }) => id))).toEqual([[tee.id, jeans.id, trainers.id]])
    expect(first.exhausted).toBe(true)
    const seen = new Set([outfitKeyOf([tee.id, jeans.id, trainers.id])])
    expect(proposed(brief(small, { seen }), 'b', 6).outfits).toEqual([])
  })

  test('clean drawings come first once a place has two, and every photo still has its turn', () => {
    const photos = [piece('shortSleeveTops'), piece('shortSleeveTops'), piece('shortSleeveTops')]
    const drawings = [piece('shirts', { drawn: true }), piece('shirts', { drawn: true })]
    const run = proposed(brief([...photos, ...drawings, jeans, trainers]), 'a', 12)
    expect(run.outfits).toHaveLength(5)
    expect(drawings).toContain(run.outfits[0]?.[0])
  })

  test('a knit or a hoodie goes over a lighter top, worn after it, and on cold days now and then', () => {
    const request = brief(wardrobe)
    expect(validated(request, [knit.id, tee.id, jeans.id, trainers.id])).toEqual(
      Option.some([tee, knit, jeans, trainers]),
    )
    expect(validated(request, [tee.id, shirt.id, jeans.id, trainers.id])).toEqual(Option.none())
    const hoodie = piece('hoodies')
    expect(validated(brief([...wardrobe, hoodie]), [knit.id, hoodie.id, jeans.id, trainers.id])).toEqual(Option.none())
    const cold = drawnOver(brief(wardrobe, { brief: { season: 'winter' } }))
    expect(cold.some((outfit) => outfit.includes(knit) && outfit.includes(tee))).toBe(true)
  })

  test('a dress never takes a top, not even a knit or a hoodie over it, while a coat or a blazer may go over it', () => {
    const hoodie = piece('hoodies')
    const blazer = piece('blazers')
    const layered = [...wardrobe, hoodie, blazer]
    for (const season of ['winter', 'autumn'] as const) {
      const outfits = drawnOver(brief(layered, { fixed: [dress], brief: { season } }))
      expect(outfits.length).toBeGreaterThan(0)
      for (const outfit of outfits) {
        expect(outfit).toContain(dress)
        expect(slotsOf(outfit)).not.toContain('top')
        expect(slotsOf(outfit)).not.toContain('bottom')
      }
      expect(outfits.some((outfit) => outfit.includes(coat) || outfit.includes(blazer))).toBe(true)
    }
    // Free of a fixed piece, an outfit on a dress keeps the same rule.
    for (const outfit of drawnOver(brief(layered, { brief: { season: 'winter' } })).filter((one) =>
      one.includes(dress),
    ))
      expect(slotsOf(outfit)).not.toContain('top')
    expect(validated(brief(layered), [dress.id, knit.id, trainers.id])).toEqual(Option.none())
    expect(validated(brief(layered), [dress.id, hoodie.id, trainers.id])).toEqual(Option.none())
    expect(validated(brief(layered), [dress.id, coat.id, trainers.id])).toEqual(Option.some([dress, coat, trainers]))
    expect(validated(brief(layered), [dress.id, blazer.id, trainers.id])).toEqual(
      Option.some([dress, blazer, trainers]),
    )
  })

  test('a proposal with a foreign piece, two tops, no shoes or a fixed piece left out is refused', () => {
    const request = brief(wardrobe, { fixed: [jeans] })
    const stranger = PieceId.make(`pc_${'z'.repeat(22)}`)
    expect(validated(request, [tee.id, jeans.id, trainers.id])).toEqual(Option.some([tee, jeans, trainers]))
    expect(validated(request, [tee.id, jeans.id, stranger])).toEqual(Option.none())
    expect(validated(request, [tee.id, shirt.id, jeans.id, trainers.id])).toEqual(Option.none())
    expect(validated(request, [tee.id, jeans.id])).toEqual(Option.none())
    expect(validated(request, [tee.id, skirt.id, trainers.id])).toEqual(Option.none())
  })

  test('a wardrobe short of a whole outfit says what it lacks; a dress stands in for a top and a bottom', () => {
    expect(missingOf(brief([tee, bag]))).toEqual(['bottom', 'shoes'])
    expect(missingOf(brief([dress]))).toEqual(['shoes'])
    expect(missingOf(brief([tee, jeans, trainers]))).toEqual([])
    // A fixed top sets separates: with no bottom in the wardrobe, the bottom is what is missing.
    expect(missingOf(brief([tee, trainers], { fixed: [tee] }))).toEqual(['bottom'])
    expect(missingOf(brief([dress], { fixed: [dress] }))).toEqual(['shoes'])
    // Without a bottom, what there is is still worn: the top, and a bag now and then.
    const partial = drawnOver(brief([tee, bag]))
    expect(partial.length).toBeGreaterThan(0)
    for (const outfit of partial) expect(outfit[0]).toBe(tee)
  })
})

describe('Thinking’s proposals', () => {
  const request = brief([tee, shirt, jeans, trainers], { fixed: [jeans] })

  test('the model sees short references, never a piece’s id', () => {
    const { messages, pieceOf } = proposalMessages(request, 3)
    const text = messages.map(({ content }) => content).join('\n')
    expect(text).not.toContain('pc_')
    expect(text).toContain('Fixed: p1.')
    expect(pieceOf.get('p1')).toBe(jeans)
  })

  test('hears what the person wears most and asked to keep in mind, and nothing when nothing is known', () => {
    const told = proposalMessages({ ...request, taste: { likes: ['navy', 'jeans'], remember: ['Never heels'] } }, 3)
    const text = told.messages.map(({ content }) => content).join('\n')
    expect(text).toContain('They wear these most: navy, jeans. Lean on them when they suit.')
    expect(text).toContain('They asked to keep in mind: “Never heels”. Never propose what these rule out.')
    const plain = proposalMessages(request, 3)
      .messages.map(({ content }) => content)
      .join('\n')
    expect(plain).not.toContain('They wear these most')
    expect(plain).not.toContain('keep in mind')
  })

  test('keeps only whole, new outfits of the person’s pieces, once each', () => {
    const { pieceOf } = proposalMessages(request, 3)
    const answer = {
      outfits: [
        { pieces: ['p2', 'p1', 'p4'] },
        { pieces: ['p2', 'p1', 'p4'] },
        { pieces: ['p3', 'p1', 'p9'] },
        { pieces: ['p2', 'p3', 'p1', 'p4'] },
        { pieces: ['p2', 'p4'] },
      ],
    }
    expect(keptProposals(request, answer, pieceOf)).toEqual([[tee, jeans, trainers]])
    const seen = new Set([outfitKeyOf([tee.id, jeans.id, trainers.id])])
    expect(keptProposals({ ...request, seen }, answer, pieceOf)).toEqual([])
  })
})

const accessoriesOf = (outfit: ReadonlyArray<Wearable>) => outfit.filter(({ type }) => slotOf(type) === 'accessory')
const systemOf = (request: Brief) => proposalMessages(request, 6).messages[0]?.content ?? ''
const proposal = (score: number, ...worn: ReadonlyArray<Wearable>): OutfitProposal => ({
  key: outfitKeyOf(worn.map(({ id }) => id)),
  pieceIds: worn.map(({ id }) => id),
  score,
})

describe('complete outfits (T-10)', () => {
  const belt = piece('belts')
  const hat = piece('hats')
  const necklace = piece('jewellery')
  const tote = piece('bags', { colours: ['black'] })
  const socks = piece('socks')
  const styled = [...wardrobe, belt, hat, necklace, tote, socks]

  test('every outfit wears the anchor, a base, shoes and one to three accessories of different kinds, never socks', () => {
    const outfits = drawnOver(brief(styled, { fixed: [tee], complete: true }))
    expect(outfits.length).toBeGreaterThan(20)
    for (const outfit of outfits) {
      const slots = slotsOf(outfit)
      const accessories = accessoriesOf(outfit)
      expect(outfit).toContain(tee)
      expect(slots).toContain('bottom')
      expect(slots.filter((slot) => slot === 'shoes')).toHaveLength(1)
      expect(accessories.length).toBeGreaterThanOrEqual(1)
      expect(accessories.length).toBeLessThanOrEqual(3)
      expect(new Set(accessories.map(({ type }) => type)).size).toBe(accessories.length)
      expect(accessories).not.toContain(socks)
    }
    expect(new Set(outfits.map((outfit) => accessoriesOf(outfit).length))).toEqual(new Set([1, 2, 3]))
  })

  test('a dress anchor takes no bottom; an accessory anchor is one of the three, and no second of its kind', () => {
    for (const outfit of drawnOver(brief(styled, { fixed: [dress], complete: true })))
      expect(slotsOf(outfit).filter((slot) => slot === 'top' || slot === 'bottom')).toEqual([])
    for (const outfit of drawnOver(brief(styled, { fixed: [bag], complete: true }))) {
      expect(accessoriesOf(outfit)).toContain(bag)
      expect(accessoriesOf(outfit)).not.toContain(tote)
      expect(accessoriesOf(outfit).length).toBeLessThanOrEqual(3)
    }
  })

  test('a wardrobe whose only accessory is socks still makes complete outfits, with nothing invented', () => {
    const plain = [tee, jeans, trainers, socks]
    const request = brief(plain, { fixed: [jeans], complete: true })
    const outfits = drawnOver(request)
    expect(outfits.length).toBeGreaterThan(0)
    for (const outfit of outfits) expect(accessoriesOf(outfit)).toEqual([])
    expect(missingOf(request)).toEqual([])
  })

  test('the rules refuse a complete outfit with no accessory, four, two of a kind or loose socks', () => {
    const complete = brief(styled, { complete: true })
    const base = [tee.id, jeans.id, trainers.id]
    expect(validated(complete, [...base, belt.id, necklace.id])).toSatisfy(Option.isSome)
    expect(validated(complete, base)).toSatisfy(Option.isNone)
    expect(validated(complete, [...base, belt.id, hat.id, necklace.id, bag.id])).toSatisfy(Option.isNone)
    expect(validated(complete, [...base, bag.id, tote.id])).toSatisfy(Option.isNone)
    expect(validated(complete, [...base, belt.id, socks.id])).toSatisfy(Option.isNone)
    // An outfit not asked to be complete keeps its old rules.
    expect(validated(brief(styled), base)).toSatisfy(Option.isSome)
    expect(validated(brief(styled), [...base, belt.id, hat.id, necklace.id])).toSatisfy(Option.isNone)
  })

  test('Thinking is asked for complete outfits only when they are wanted', () => {
    expect(systemOf(brief(styled, { complete: true }))).toContain('one to three accessories')
    expect(systemOf(brief(styled))).not.toContain('one to three accessories')
  })

  test('a complete batch repeats as few pieces as it can, the fixed ones aside, keeping Clef’s order on a tie', () => {
    const best = proposal(0.9, tee, jeans, trainers, bag)
    const sameShoes = proposal(0.8, tee, skirt, trainers, belt)
    const fresh = proposal(0.7, tee, shorts, sandals, hat)
    const alsoFresh = proposal(0.6, tee, skirt, sandals, necklace)
    const ranked = [best, sameShoes, fresh, alsoFresh]
    expect(distinct(ranked, 2, new Set([tee.id]))).toEqual([best, fresh])
    expect(distinct(ranked, 3, new Set([tee.id]))).toEqual([best, fresh, sameShoes])
    expect(distinct(ranked, 9, new Set([tee.id]))).toHaveLength(4)
  })
})

describe("Thinking's share of a large wardrobe", () => {
  test('deals every place in turn, so old shoes and bags are sent with two hundred newer tops', () => {
    const tops = Array.from({ length: 200 }, () => piece('shortSleeveTops'))
    const oldShoes = [piece('trainers'), piece('boots')]
    const oldBag = piece('bags')
    const sent = sentFrom([...tops, ...oldShoes, oldBag], 150)
    expect(sent).toHaveLength(150)
    expect(sent).toEqual(expect.arrayContaining([...oldShoes, oldBag]))
    expect(sentFrom(tops.slice(0, 3), 150)).toEqual(tops.slice(0, 3))
  })
})
