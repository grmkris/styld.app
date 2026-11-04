import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { BoardTag, BoardTranslation, ProfileTranslation } from '../src/index.ts'

// The house boards' tags and translations (owner, 4 November 2026) decode only what the tables may hold.

const isTag = Schema.is(BoardTag)
const isBoardTranslation = Schema.is(BoardTranslation)
const isProfileTranslation = Schema.is(ProfileTranslation)

describe('board tags', () => {
  test('each kind takes its own values', () => {
    expect(isTag({ kind: 'audience', value: 'women' })).toBe(true)
    expect(isTag({ kind: 'season', value: 'winter' })).toBe(true)
    expect(isTag({ kind: 'template', value: 'onePiece' })).toBe(true)
    expect(isTag({ kind: 'occasion', value: 'smart' })).toBe(true)
    expect(isTag({ kind: 'aesthetic', value: 'city-break' })).toBe(true)
  })

  test('an unknown audience, a value of another kind, or a long or unslugged aesthetic is refused', () => {
    expect(isTag({ kind: 'audience', value: 'kids' })).toBe(false)
    expect(isTag({ kind: 'season', value: 'smart' })).toBe(false)
    expect(isTag({ kind: 'aesthetic', value: 'a'.repeat(41) })).toBe(false)
    expect(isTag({ kind: 'aesthetic', value: 'City Break' })).toBe(false)
    expect(isTag({ kind: 'colour', value: 'red' })).toBe(false)
  })
})

describe('translations', () => {
  const board = { locale: 'sl', name: 'Lizbona, 5 dni', labels: { bi_x: '12 kosov' }, review: 'pending' }
  const profile = { locale: 'sl', name: 'Styld Ženske', bio: 'Formule za videze.', review: 'pending' }

  test('a board’s and a profile’s Slovenian decode, pending review', () => {
    expect(isBoardTranslation(board)).toBe(true)
    expect(isProfileTranslation(profile)).toBe(true)
  })

  test('a name over 60, a label over 140, a bio over 160 or another language is refused', () => {
    expect(isBoardTranslation({ ...board, name: 'n'.repeat(61) })).toBe(false)
    expect(isBoardTranslation({ ...board, labels: { bi_x: 'l'.repeat(141) } })).toBe(false)
    expect(isBoardTranslation({ ...board, locale: 'de' })).toBe(false)
    expect(isProfileTranslation({ ...profile, name: 'n'.repeat(61) })).toBe(false)
    expect(isProfileTranslation({ ...profile, bio: 'b'.repeat(161) })).toBe(false)
    expect(isProfileTranslation({ ...profile, review: 'done' })).toBe(false)
  })
})
