import * as Domain from '@alchemy.run/domain'
import { describe, expect, it } from '@effect/vitest'
import { Styld } from '@styld/domain/Styld.model'
import { CurrentAccount, freeCredits, memberDailyCredits, prices } from '@styld/protocol'
import { DateTime, Deferred, Effect, Fiber, Layer, Option, Ref } from 'effect'
import { admitJob } from '../src/generation/Admission.ts'
import { work } from '../src/generation/Work.ts'
import { Boards } from '../src/boards/Boards.ts'
import { PicturePainter } from '../src/generation/Painter.ts'
import { MoodPlanner } from '../src/generation/Planner.ts'
import { GenerationStore, type JobRow } from '../src/generation/Store.ts'
import { Database, nowDate } from '../src/kernel/Db.ts'
import { identify, receiptRow } from '../src/kernel/Receipts.ts'
import { ContentJudge, passed } from '../src/safety/Judge.ts'
import { busy } from '../src/providers/Errors.ts'
import { AttemptElsewhere, PaidAttempts, type Work as PaidWork } from '../src/usage/Attempts.ts'
import { Holds } from '../src/usage/Holds.ts'
import { Wardrobe } from '../src/wardrobe/Wardrobe.ts'
import { localD1 } from './LocalD1.ts'
import { unusedBoards } from './fakes/Boards.ts'
import { unusedWardrobe } from './fakes/Wardrobe.ts'

/** A member's credits on a fresh day: the day's allowance and the free credits. */
const allCredits = memberDailyCredits + freeCredits

const over = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0);
    INSERT INTO memberships (account_id, plan, until, status, updated_at) VALUES ('ac_1', 'lifetime', NULL, 'active', 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at) VALUES ('bd_1', 'ac_1', 'Trip', 'paper', 0, 'private', '[]', 'trip', 0, 0);
  `)
  const db = Database.layer(database)
  const wallet = Styld.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))
  const layer = Layer.mergeAll(
    GenerationStore.layer.pipe(Layer.provide(db)),
    Holds.layer.pipe(Layer.provide(Layer.merge(wallet, db))),
  )
  return { database, layer }
}

const inserted = Effect.gen(function* () {
  const at = yield* nowDate
  const job: JobRow = {
    id: 'gj_1',
    accountId: 'ac_1',
    boardId: 'bd_1',
    kind: 'sticker',
    prompt: 'a lemon',
    status: 'admitting',
    reason: null,
    collageVersion: 0,
    moods: [],
    createdAt: at,
    updatedAt: at,
  }
  const operation = yield* identify({
    accountId: 'ac_1',
    operationId: 'ask-1',
    command: 'generate',
    input: ['sticker', 'bd_1', 'a lemon'],
  })
  yield* (yield* GenerationStore).insertJob(
    job,
    [{ jobId: job.id, prompt: 'a lemon', status: 'waiting', imageId: null, startedAt: null }],
    yield* receiptRow(operation, job.id),
  )
  return job
})

const passing = Layer.succeed(ContentJudge, { judge: () => Effect.succeed(passed) })
const boards = Boards.of(unusedBoards)
const wardrobe = Wardrobe.of(unusedWardrobe)
const planner = MoodPlanner.of({ plan: () => Effect.succeed(Option.none()) })

describe('generation admission', () => {
  it.effect('resumes a committed job and reserves once before making it runnable', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const job = yield* inserted
      const store = yield* GenerationStore
      expect(Option.getOrThrow(yield* store.findReceipt('ac_1', 'ask-1')).result).toBe(job.id)
      yield* admitJob(job)
      yield* admitJob(job)
      expect(Option.getOrThrow(yield* store.findJob('ac_1', job.id)).status).toBe('drawing')
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits - prices.sticker)
    }).pipe(Effect.provide(Layer.merge(layer, passing)))
  })

  it.effect('does not erase a winner that completed while a slower admission failed', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const job = yield* inserted
      const store = yield* GenerationStore
      const context = yield* Effect.context<GenerationStore | Holds>()
      const losingJudge = ContentJudge.of({
        judge: () =>
          Effect.gen(function* () {
            yield* admitJob(job).pipe(Effect.provide(passing))
            yield* store.advanceJob(job.id, ['drawing'], { status: 'refused', reason: 'refused' })
          }).pipe(Effect.provide(context), Effect.orDie, Effect.andThen(busy('workers-ai'))),
      })
      expect(
        yield* Effect.flip(admitJob(job, 'ask-1').pipe(Effect.provideService(ContentJudge, losingJudge))),
      ).toMatchObject({ _tag: 'Unavailable' })
      expect(Option.getOrThrow(yield* store.findJob('ac_1', job.id)).status).toBe('refused')
      expect(Option.getOrThrow(yield* store.findReceipt('ac_1', 'ask-1')).result).toBe(job.id)
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits - prices.sticker)
    }).pipe(Effect.provide(layer))
  })

  it.effect('expires old admission before asking a provider or reserving credits', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const job = yield* inserted
      const old = { ...job, createdAt: DateTime.toDateUtc(DateTime.subtract(yield* DateTime.now, { minutes: 31 })) }
      yield* admitJob(old)
      expect(Option.getOrThrow(yield* (yield* GenerationStore).findJob('ac_1', job.id)).status).toBe('failed')
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits)
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(ContentJudge, { judge: () => Effect.die(new Error('expired work reached provider')) }),
    )
  })

  it.effect('keeps only the winning plan and never adds picks to a failed job', () => {
    const { layer, database } = over()
    database.sqlite.exec(`
      INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type, created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k1', 'image/png', 0, 0),
             ('pc_2', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k2', 'image/png', 0, 0);
    `)
    return Effect.gen(function* () {
      const job = yield* inserted
      const store = yield* GenerationStore
      yield* store.advanceJob(job.id, ['admitting'], { status: 'planning' })
      yield* store.planned(job.id, { picks: ['pc_1'], moods: [] }, yield* nowDate)
      yield* store.planned(job.id, { picks: ['pc_2', 'pc_1'], moods: ['calm'] }, yield* nowDate)
      expect(yield* store.picksOf(job.id)).toEqual(['pc_1'])
      yield* store.giveUp(job.id, yield* nowDate)
      yield* store.planned(job.id, { picks: ['pc_2'], moods: [] }, yield* nowDate)
      expect(yield* store.picksOf(job.id)).toEqual(['pc_1'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('leaves a planning job to the delivery that owns its live planner claim', () => {
    const { layer } = over()
    const planning = Layer.mergeAll(
      layer,
      Layer.succeed(CurrentAccount, { accountId: 'ac_1', via: 'assistant' as const }),
      Layer.succeed(Boards, boards),
      Layer.succeed(Wardrobe, wardrobe),
      Layer.succeed(MoodPlanner, planner),
      Layer.succeed(PicturePainter, PicturePainter.of({ paint: () => Effect.die('not used by this test') })),
      passing,
    )
    return Effect.gen(function* () {
      const job = yield* inserted
      const store = yield* GenerationStore
      yield* store.advanceJob(job.id, ['admitting'], { status: 'planning' })

      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const calls = yield* Ref.make(0)
      const attempts = PaidAttempts.of({
        run: <A, E, R>(paidWork: PaidWork<A>, effect: Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            const call = yield* Ref.updateAndGet(calls, (count) => count + 1)
            if (call === 1) {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(releaseFirst)
              return yield* effect
            }
            // A duplicate delivery finds the first planner's live claim.
            void paidWork
            return yield* Effect.fail(AttemptElsewhere.make({}))
          }),
        charged: () => Effect.die('not used by this test'),
        abandon: () => Effect.die('not used by this test'),
        forget: () => Effect.die('not used by this test'),
      })

      const first = yield* Effect.forkChild(
        work(job.id).pipe(Effect.provide(planning), Effect.provideService(PaidAttempts, attempts)),
      )
      yield* Deferred.await(firstStarted)
      yield* work(job.id).pipe(Effect.provide(planning), Effect.provideService(PaidAttempts, attempts))
      expect(Option.getOrThrow(yield* store.findJob('ac_1', job.id)).status).toBe('planning')
      expect(yield* Ref.get(calls)).toBe(2)
      yield* Fiber.interrupt(first)
    }).pipe(Effect.provide(planning))
  })
})
