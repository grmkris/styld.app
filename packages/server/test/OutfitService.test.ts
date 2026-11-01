import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, type MakeOutfit, OperationId } from '@styld/protocol'
import { Effect, Layer, Option, Predicate } from 'effect'
import { CaptureMetrics } from '../src/capture/Metrics.ts'
import { Database } from '../src/kernel/Db.ts'
import { Media } from '../src/kernel/Media.ts'
import { OutfitJudge } from '../src/outfits/Judge.ts'
import { Outfits } from '../src/outfits/Outfits.ts'
import { Thinking } from '../src/outfits/Proposer.ts'
import { proposed } from '../src/outfits/Rules.ts'
import { unlimited } from './fakes/Pacing.ts'
import { localD1 } from './LocalD1.ts'

// The outfit engine as a service over SQLite with every migration: a repeated request answers the same batch from its
// receipt and is counted against Thinking's day once; another request under the same operation is a conflict.

/** One of Ana's ready pieces, with only its photo. */
const piece = (id: string, type: string) =>
  `INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
      content_type, bytes, created_at, updated_at)
    VALUES ('${id}', 'ac_1', NULL, '${type}', '[]', '[]', 'ready', 'website', 'ac_1/${id}.jpg', NULL, 'image/jpeg',
      1, 0, 0);`

/** Ana's wardrobe: a tee, jeans and trainers. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    ${piece(`pc_${'t'.repeat(22)}`, 'tops')}
    ${piece(`pc_${'j'.repeat(22)}`, 'jeans')}
    ${piece(`pc_${'s'.repeat(22)}`, 'trainers')}
  `)
  return database
}

/** The engine over the database; Clef never looks, Thinking proposes the rules' outfits and counts its asks. */
const engine = (database: ReturnType<typeof localD1>, thought: Array<number>) =>
  Outfits.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Database.layer(database),
        // SAFETY: no picture is ever read here -- every piece's read fails over to an unjudged outfit, as a missing picture does
        Layer.succeed(Media, Media.of({ bucket: {}, images: {} } as never)),
        Layer.succeed(OutfitJudge, OutfitJudge.of({ judge: () => Effect.succeed(Option.none()) })),
        Layer.succeed(
          Thinking,
          Thinking.of({
            propose: (request, count) =>
              Effect.sync(() => {
                thought.push(count)
                return { outfits: proposed(request, 'thinking', count).outfits, costMicroUsd: 0 }
              }),
          }),
        ),
        unlimited,
        CaptureMetrics.discard,
      ),
    ),
  )

const ask = (operationId: string, words?: string): MakeOutfit => ({
  operationId: OperationId.make(operationId),
  mode: 'thinking',
  brief: words === undefined ? {} : { words },
  lockedPieceIds: [],
  seen: [],
  count: 1,
})

const asked = (database: ReturnType<typeof localD1>) =>
  database.sqlite.prepare("SELECT asked FROM thinking_days WHERE account_id = 'ac_1'").get()

describe('a Thinking request', () => {
  it.effect('repeated under its operation id answers the same batch, counted against the day once', () => {
    const database = seeded()
    const thought: Array<number> = []
    return Effect.gen(function* () {
      const outfits = yield* Outfits
      const first = yield* outfits.make(ask('op_thinking_1'))
      expect(first.proposals).toHaveLength(1)
      expect(yield* outfits.make(ask('op_thinking_1'))).toEqual(first)
      expect(thought).toHaveLength(1)
      expect(asked(database)).toEqual({ asked: 1 })
      yield* outfits.make(ask('op_thinking_2'))
      expect(asked(database)).toEqual({ asked: 2 })
      const conflict = yield* Effect.flip(outfits.make(ask('op_thinking_1', 'something else')))
      expect(Predicate.isTagged(conflict, 'OperationConflict')).toBe(true)
    }).pipe(
      Effect.provide(engine(database, thought)),
      Effect.provideService(CurrentAccount, { accountId: 'ac_1', via: 'session' }),
    )
  })
})
