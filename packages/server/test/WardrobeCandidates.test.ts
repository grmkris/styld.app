import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { CaptureStore } from '../src/capture/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { localD1 } from './LocalD1.ts'

// Which of the wardrobe's pieces a new garment is compared with (T-03, F-17): of its slot's types, its own type first,
// then its main colour, then the newest. A coat worn in shade reads as black when it is brown; that it is a coat is
// surer, so the brown coat must not fall behind the black blazers.

const piece = (id: string, type: string, colour: string, createdAt: number) =>
  `INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key,
    content_type, created_at, updated_at)
    VALUES ('${id}', 'ac_1', '${type}', '["${colour}"]', '[]', 'ready', 'website', 'o/${id}', 'c/${id}',
    'image/png', ${createdAt}, ${createdAt});`
const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map(({ id }) => id)

const wardrobe = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Eva', 0);
    ${piece('pc_coat_brown', 'coats', 'brown', 1)}
    ${piece('pc_blazer_black', 'blazers', 'black', 3)}
    ${piece('pc_blazer_black_2', 'blazers', 'black', 4)}
    ${piece('pc_coat_black', 'coats', 'black', 2)}
    ${piece('pc_jacket_grey', 'jackets', 'grey', 5)}
  `)
  return CaptureStore.layer.pipe(Layer.provide(Database.layer(database)))
}

describe("the wardrobe's pieces a garment is compared with", () => {
  it.effect('puts its own type first, then its colour, then the newest', () =>
    Effect.gen(function* () {
      const store = yield* CaptureStore
      const outerwear = ['coats', 'blazers', 'jackets'] as const
      expect(ids(yield* store.wardrobeCandidates('ac_1', outerwear, { type: 'coats', colour: 'black' }, 3))).toEqual([
        'pc_coat_black',
        'pc_coat_brown',
        'pc_blazer_black_2',
      ])
      // With no type read, colour leads as before.
      expect(ids(yield* store.wardrobeCandidates('ac_1', outerwear, { type: null, colour: 'black' }, 2))).toEqual([
        'pc_blazer_black_2',
        'pc_blazer_black',
      ])
      // Nor colour: the newest. SQLite refuses `ORDER BY 0`, so this once failed every garment Clef gave no colour.
      expect(ids(yield* store.wardrobeCandidates('ac_1', outerwear, { type: null, colour: undefined }, 2))).toEqual([
        'pc_jacket_grey',
        'pc_blazer_black_2',
      ])
    }).pipe(Effect.provide(wardrobe())),
  )
})
