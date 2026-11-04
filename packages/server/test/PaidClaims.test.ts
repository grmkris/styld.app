import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { CaptureStore } from '../src/capture/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { localD1 } from './LocalD1.ts'

// A paid request for a piece's next redraw or turn claims it before any credit is held: a move from the state and
// the attempt it read. Of two requests that read the same row, one claims it; the other holds nothing, so it can never
// settle the winner's hold. A claim whose credit could not be held is taken back, keeping its number.

const over = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type,
      created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0);
    INSERT INTO piece_pictures (piece_id, account_id, state, version, redraws, paid, created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'ready', 1, 2, 1, 0, 0);
    INSERT INTO piece_turns (piece_id, account_id, state, attempt, created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'ready', 0, 0, 0);
  `)
  return CaptureStore.layer.pipe(Layer.provide(Database.layer(database)))
}

const at = new Date(1000)

describe('claiming a paid attempt', () => {
  it.effect('gives a redraw to one of two requests that read the same picture, and takes it back as it was', () =>
    Effect.gen(function* () {
      const store = yield* CaptureStore
      const seen = { state: 'ready' as const, redraws: 2 }
      const queued = { state: 'queued' as const, redraws: 3, paid: true, updatedAt: at }
      const claims = yield* Effect.all([
        store.claimRedraw('pc_1', seen, queued),
        store.claimRedraw('pc_1', seen, queued),
      ])
      expect(claims).toEqual([true, false])
      // Its credit could not be held: the picture is as it was, but the redraw's number is spent.
      expect(yield* store.claimRedraw('pc_1', { state: 'queued', redraws: 3 }, { state: 'ready' })).toBe(true)
      const picture = yield* store.findPicture('pc_1')
      expect(Option.map(picture, ({ state, redraws }) => [state, redraws])).toEqual(Option.some(['ready', 3]))
      // A request that read the picture before the claim cannot claim the same redraw again.
      expect(yield* store.claimRedraw('pc_1', seen, queued)).toBe(false)
    }).pipe(Effect.provide(over())),
  )

  it.effect('gives a turn to one of two requests that read the same turn, and drops a first one taken back', () =>
    Effect.gen(function* () {
      const store = yield* CaptureStore
      const seen = { state: 'ready' as const, attempt: 0 }
      const requested = { state: 'requested' as const, attempt: 1, operation: null, layout: null, updatedAt: at }
      const claims = yield* Effect.all([
        store.claimTurn('pc_1', seen, requested),
        store.claimTurn('pc_1', seen, requested),
      ])
      expect(claims).toEqual([true, false])
      yield* store.dropTurn('pc_1', 0)
      expect(Option.map(yield* store.findTurn('pc_1'), ({ attempt }) => attempt)).toEqual(Option.some(1))
      yield* store.dropTurn('pc_1', 1)
      expect(yield* store.findTurn('pc_1')).toEqual(Option.none())
    }).pipe(Effect.provide(over())),
  )
})
