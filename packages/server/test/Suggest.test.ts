import { describe, expect, test } from 'vitest'
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
