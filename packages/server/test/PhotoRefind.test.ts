import { describe, expect, test } from 'vitest'
import { mergedWith } from '../src/photos/Merge.ts'
import type { GarmentRow } from '../src/photos/Store.ts'

// The operator's re-find of a photo (Eva, 4 November): what the person decided stays, Styld's own guesses give way to
// what the detector finds now.

const row = (id: string, fields: Partial<GarmentRow>): GarmentRow => ({
  id,
  photoId: 'ph_1',
  accountId: 'ac_1',
  position: 0,
  cutoutKey: `photos/${id}.png`,
  type: 'jeans',
  colours: [],
  pieceId: null,
  state: 'unmatched',
  ...fields,
})

describe('a photo found again', () => {
  const confirmed = row('pg_confirmed', { position: 0, state: 'confirmed', pieceId: 'pc_jeans' })
  const offered = row('pg_offered', { position: 1, state: 'offered' })
  const byHand = row('pg_hand', { position: 2, state: 'confirmed', pieceId: 'pc_cardigan', cutoutKey: null })
  const guess = row('pg_guess', { position: 3, state: 'suggested', pieceId: 'pc_tee' })
  const nothing = row('pg_nothing', { position: 4 })

  test("keeps what the person confirmed, offered or added by hand, and replaces Styld's guesses", () => {
    const found = [row('pg_new_top', { position: 0, state: 'suggested', pieceId: 'pc_tee' })]
    const { added, replaced } = mergedWith([confirmed, offered, byHand, guess, nothing], found)
    expect(replaced.map(({ id }) => id)).toEqual(['pg_guess', 'pg_nothing'])
    // What was found follows what stays, so no position is taken twice.
    expect(added).toEqual([{ ...found[0], position: 3 }])
  })

  test('drops a garment suggesting a piece already confirmed in the photo, by hand or by a match', () => {
    const found = [
      row('pg_jeans_again', { state: 'suggested', pieceId: 'pc_jeans' }),
      row('pg_cardigan_again', { position: 1, state: 'suggested', pieceId: 'pc_cardigan' }),
      row('pg_shoes', { position: 2 }),
    ]
    expect(mergedWith([confirmed, byHand], found).added.map(({ id }) => id)).toEqual(['pg_shoes'])
  })

  test('a repeated delivery replaces nothing it wrote itself: its garments are already the guesses', () => {
    const first = [row('pg_a', { position: 0 }), row('pg_b', { position: 1 })]
    const { added } = mergedWith([confirmed], first)
    expect(mergedWith([confirmed, ...added], first).replaced).toEqual([])
  })
})
