import { describe, expect, test } from 'vitest'
import { suggestionOfRow } from '../src/capture/Captures.ts'
import type { DetectionRow } from '../src/capture/Store.ts'

// The review item a found piece becomes: the type the decision model was torn with reaches it beside the first.
const row = (
  suggestedType: DetectionRow['suggestedType'],
  suggestedAlternative: DetectionRow['suggestedAlternative'],
): DetectionRow => ({
  id: 'dt_1',
  captureId: 'cp_1',
  accountId: 'ac_1',
  status: 'review',
  cutoutKey: 'cut.png',
  sourceKey: 'photo.jpg',
  backCutoutKey: null,
  confidence: 0.9,
  preselected: true,
  suggestedType,
  suggestedAlternative,
  suggestedColours: ['black'],
  suggestedSeasons: [],
  suggestedRainproof: false,
  suggestedCategory: null,
  suggestedOccasions: ['sport'],
  suggestedPattern: 'plain',
  whole: 0.9,
  groupOf: null,
  duplicateOf: null,
  matching: null,
  matchClaimedAt: null,
  createdAt: new Date(0),
})

describe('the review item of a torn answer', () => {
  test('carries the runner-up beside the first type', () => {
    expect(suggestionOfRow(row('trousers', 'sportBottoms'))).toEqual({
      type: 'trousers',
      alternative: 'sportBottoms',
      colours: ['black'],
      seasons: [],
      rainproof: false,
      occasions: ['sport'],
      pattern: 'plain',
    })
  })

  test('offers none for a sure answer, or one that names the first type again', () => {
    expect('alternative' in suggestionOfRow(row('skirts', null))).toBe(false)
    expect('alternative' in suggestionOfRow(row('skirts', 'skirts'))).toBe(false)
  })
})
