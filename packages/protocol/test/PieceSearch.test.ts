import { describe, expect, it } from 'vitest'
import { pieceMatches, type Searchable } from '../src/PieceSearch.ts'

// The one piece search the website, the assistants and Styld's chat share: ready pieces only, every word typed
// matching a word the piece answers to, its type, group and colours named in the languages asked.

const tee: Searchable = {
  name: 'Old favourite',
  notes: null,
  brand: 'Uniqlo',
  type: 'shortSleeveTops',
  colours: ['navy'],
  seasons: ['summer'],
  occasions: ['casual'],
  pattern: 'plain',
  status: 'ready',
}

describe('the piece search', () => {
  it('finds a piece by the words people use for its type, its group and its colours, in either language', () => {
    expect(pieceMatches(tee, { q: 'tee' }, ['en'])).toBe(true)
    expect(pieceMatches(tee, { q: 'navy tops' }, ['en'])).toBe(true)
    expect(pieceMatches(tee, { q: 'majica' }, ['en'])).toBe(false)
    expect(pieceMatches(tee, { q: 'majica' }, ['en', 'sl'])).toBe(true)
    expect(pieceMatches(tee, { q: 'MORNARSKO' }, ['sl'])).toBe(true)
  })

  it('finds a piece by its own name, notes and brand, every word of the query', () => {
    expect(pieceMatches(tee, { q: 'favourite uniqlo' }, ['en'])).toBe(true)
    expect(pieceMatches(tee, { q: 'favourite jeans' }, ['en'])).toBe(false)
  })

  it('never finds a piece that is not ready', () => {
    expect(pieceMatches({ ...tee, status: 'processing' }, {}, ['en'])).toBe(false)
    expect(pieceMatches({ ...tee, status: 'failed' }, { q: 'tee' }, ['en'])).toBe(false)
  })

  it('keeps to the type, group and attributes asked for; a piece for all seasons fits any', () => {
    expect(pieceMatches(tee, { type: 'shortSleeveTops', colour: 'navy', occasion: 'casual' }, ['en'])).toBe(true)
    expect(pieceMatches(tee, { group: 'bottoms' }, ['en'])).toBe(false)
    expect(pieceMatches(tee, { season: 'winter' }, ['en'])).toBe(false)
    expect(pieceMatches({ ...tee, seasons: [] }, { season: 'winter' }, ['en'])).toBe(true)
    expect(pieceMatches(tee, { brand: 'uniqló' }, ['en'])).toBe(true)
    expect(pieceMatches(tee, { pattern: 'striped' }, ['en'])).toBe(false)
  })
})
