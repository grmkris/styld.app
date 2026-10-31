import { DetectionId } from '@styld/protocol'
import { describe, expect, test } from 'vitest'
import { carriedOverUnchanged } from '../src/capture/Review.ts'
import { suggestedChanges } from '../src/capture/Suggest.ts'
import type { Suggestion } from '../src/capture/Providers.ts'

const carried = { type: 'tops', season: null, occasions: [], pattern: null }
const suggestion = (fields: Partial<Suggestion>): Suggestion => ({
  type: 'knitwear',
  confidence: 0.9,
  colours: [],
  season: 'cold',
  occasions: ['casual'],
  pattern: 'plain',
  whole: 1,
  ...fields,
})

describe('asking about a piece carried over from the old categories', () => {
  test('refines its type within the group when the model is sure, and fills its attributes', () => {
    expect(suggestedChanges(carried, suggestion({}))).toEqual({
      type: 'knitwear',
      season: 'cold',
      occasions: ['casual'],
      pattern: 'plain',
    })
  })

  test('keeps its type when the model is unsure, or names another group', () => {
    expect(suggestedChanges(carried, suggestion({ confidence: 0.4 }))).not.toHaveProperty('type')
    expect(suggestedChanges(carried, suggestion({ type: 'boots' }))).not.toHaveProperty('type')
    expect(suggestedChanges(carried, suggestion({ type: undefined }))).not.toHaveProperty('type')
  })

  test('never overwrites an attribute the piece already has', () => {
    const known = { ...carried, season: 'warm', occasions: ['smart'], pattern: 'striped' }
    expect(suggestedChanges(known, suggestion({}))).toEqual({ type: 'knitwear' })
  })
})

describe('keeping a garment found before garment types', () => {
  const found = { suggestedType: 'tops', suggestedSeason: null, suggestedOccasions: [], suggestedPattern: null }
  const keep = { detectionId: DetectionId.make(`dt_${'a'.repeat(22)}`), type: 'tops' } as const

  test('kept as the migration left it, the new piece waits for the sweep to ask about it', () => {
    expect(carriedOverUnchanged(found, keep)).toBe(true)
  })

  test('a type or an attribute the person chose, or one Clef already suggested, is final', () => {
    expect(carriedOverUnchanged(found, { ...keep, type: 'shirts' })).toBe(false)
    expect(carriedOverUnchanged(found, { ...keep, season: 'warm' })).toBe(false)
    expect(carriedOverUnchanged({ ...found, suggestedSeason: 'cold' }, keep)).toBe(false)
  })
})
