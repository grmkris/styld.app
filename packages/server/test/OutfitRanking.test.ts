import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, type MakeOutfit, OperationId } from '@styld/protocol'
import { Duration, Effect, Fiber, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { CaptureMetrics } from '../src/kernel/Metrics.ts'
import { Database } from '../src/kernel/Db.ts'
import { Media } from '../src/kernel/Media.ts'
import { OutfitJudge } from '../src/outfits/Judge.ts'
import { judgingBudget, Outfits } from '../src/outfits/Outfits.ts'
import { Thinking } from '../src/outfits/Proposer.ts'
import { WardrobeStore } from '../src/wardrobe/Store.ts'
import { unlimited } from './fakes/Pacing.ts'
import { localD1 } from './LocalD1.ts'

// How long Fast's first outfit takes (browser review, 2 November 2026: POST /api/outfits answered in 11.3 s on a cold
// visit). Fast draws 12 candidates and Clef judges each; they used to be judged six at a time, two waves of Clef's
// latency, with no bound when Clef was slow. Now all twelve go at once, and ranking stops at `judgingBudget`.

/** One of Ana's ready pieces, with only its photo. */
const piece = (id: string, type: string) =>
  `INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
      content_type, created_at, updated_at)
    VALUES ('${id}', 'ac_1', NULL, '${type}', '[]', '[]', 'ready', 'website', 'ac_1/${id}.jpg', NULL, 'image/jpeg',
      0, 0);`

/** Ana's wardrobe: four tops, three jeans and two trainers, far more than twelve outfits. */
const seeded = () => {
  const database = localD1()
  const pieces = [
    ...['a', 'b', 'c', 'd'].map((seed) => piece(`pc_${`t${seed}`.padEnd(22, 'x')}`, 'tops')),
    ...['a', 'b', 'c'].map((seed) => piece(`pc_${`j${seed}`.padEnd(22, 'x')}`, 'jeans')),
    ...['a', 'b'].map((seed) => piece(`pc_${`s${seed}`.padEnd(22, 'x')}`, 'trainers')),
  ]
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    ${pieces.join('\n')}
  `)
  return database
}

/** Every piece's judging picture is already kept beside it. */
const kept = {
  get: () =>
    Promise.resolve({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      httpMetadata: { contentType: 'image/webp' },
    }),
}

/** The engine with Clef taking `latency` a call, scoring an outfit higher the later it was drawn; `calls` counts
 * Clef's calls at once, at most. */
const engine = (latency: Duration.Input, calls: { now: number; most: number }) => {
  let drawn = 0
  const judge = OutfitJudge.of({
    judge: () =>
      Effect.gen(function* () {
        drawn += 1
        const score = drawn / 100
        calls.now += 1
        calls.most = Math.max(calls.most, calls.now)
        yield* Effect.sleep(latency)
        return Option.some({ score, costMicroUsd: 1 })
      }).pipe(Effect.ensuring(Effect.sync(() => void (calls.now -= 1)))),
  })
  return Outfits.layer.pipe(
    Layer.provide(WardrobeStore.layer),
    Layer.provide(
      Layer.mergeAll(
        Database.layer(seeded()),
        // SAFETY: every judging picture is already kept beside its piece -- judgingPicture calls only bucket.get, which the fake answers
        Layer.succeed(Media, Media.of({ bucket: kept, images: {} } as never)),
        Layer.succeed(OutfitJudge, judge),
        Layer.succeed(Thinking, Thinking.of({ propose: () => Effect.die('not asked') })),
        unlimited,
        CaptureMetrics.discard,
      ),
    ),
  )
}

const fast: MakeOutfit = {
  operationId: OperationId.make('op_fast_1'),
  mode: 'fast',
  brief: {},
  lockedPieceIds: [],
  seen: [],
  count: 3,
}

/** One turn of the event loop, outside the test clock. */
const settled = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))

/** The batch, and how long it took on the test clock, the clock moved a second at a time once Clef's calls are out:
 * the wardrobe's reads are real promises, so the clock waits for them however busy the machine is. */
const timed = (calls: { readonly now: number }) =>
  Effect.gen(function* () {
    const making = yield* Effect.forkChild((yield* Outfits).make(fast))
    for (let turn = 0; turn < 10_000 && calls.now === 0 && making.pollUnsafe() === undefined; turn++) yield* settled
    for (let second = 1; second <= 30; second++) {
      yield* TestClock.adjust(Duration.seconds(1))
      // D1's answers are real promises: let them settle before looking.
      for (let turn = 0; turn < 20 && making.pollUnsafe() === undefined; turn++) yield* settled
      const done = making.pollUnsafe()
      if (done !== undefined) return { batch: yield* Fiber.join(making), seconds: second }
    }
    return yield* Effect.die('the batch never came')
  }).pipe(Effect.provideService(CurrentAccount, { accountId: 'ac_1', via: 'session' }))

describe('Fast’s first outfit', () => {
  it.effect('judges all twelve candidates at once: one wave of Clef’s latency, not two', () => {
    const calls = { now: 0, most: 0 }
    return Effect.gen(function* () {
      const { batch, seconds } = yield* timed(calls)
      // Six at a time, three-second calls took six seconds; all at once take three.
      expect(seconds).toBe(3)
      expect(calls.most).toBe(12)
      expect(batch.proposals).toHaveLength(3)
      // Best first: the scores Clef gave, highest first.
      const scores = batch.proposals.map(({ score }) => score)
      expect(scores).toEqual(scores.toSorted((a, b) => (b ?? 0) - (a ?? 0)))
      expect(scores.every((score) => score !== null)).toBe(true)
    }).pipe(Effect.provide(engine(Duration.seconds(3), calls)))
  })

  it.effect('a slow Clef is given up at the budget, and the rules’ outfits answer unjudged', () => {
    const calls = { now: 0, most: 0 }
    return Effect.gen(function* () {
      const { batch, seconds } = yield* timed(calls)
      expect(seconds).toBe(Duration.toSeconds(judgingBudget))
      expect(batch.proposals).toHaveLength(3)
      expect(batch.proposals.every(({ score }) => score === null)).toBe(true)
      // The calls still out were given up, not left running.
      expect(calls.now).toBe(0)
    }).pipe(Effect.provide(engine(Duration.seconds(20), calls)))
  })
})
