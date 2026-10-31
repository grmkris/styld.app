import {
  type BoardId,
  DailyLimitReached,
  type Generate,
  type GenerationKind,
  fewestMoodPictures,
  GenerationNotFound,
  mostMoodPictures,
  OperationConflict,
  PromptRefused,
} from '@styld/protocol'
import { Effect, Option, Predicate, Result } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { paintPrompt } from './PaintPrompt.ts'
import { holdOf, nowDate, type Parts, refund, send, unavailable, view } from './Parts.ts'
import { giveUp } from './Work.ts'
import type { JobRow } from './Store.ts'

/** A job not finished and not touched for this long lost its message: reading it sends it again. */
const stalledMillis = 3 * 60 * 1000

const stored = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, unavailable)

/** Hold one credit for each picture wanted, as far as today's allowance goes. */
const holdUpTo = (parts: Parts, accountId: string, jobId: string, wanted: number) =>
  Effect.gen(function* () {
    let held = 0
    for (; held < wanted; held += 1) {
      const reserved = yield* Effect.result(parts.usage.reserve(accountId, holdOf(jobId, held), 1))
      if (Result.isSuccess(reserved)) continue
      if (Predicate.isTagged(reserved.failure, 'DailyLimitReached'))
        return { held, limit: Option.some(reserved.failure) }
      // The Wallet may have taken this one too before its answer was lost.
      yield* refund(parts, accountId, jobId, 0, held + 1)
      return yield* unavailable()
    }
    return { held, limit: Option.none<DailyLimitReached>() }
  })

/** The receipt of an ask already made: the same job for the same words, a conflict for others. */
const replayed = (parts: Parts, accountId: string, operationId: string, inputDigest: string) =>
  Effect.gen(function* () {
    const receipt = yield* stored(parts.store.findReceipt(accountId, operationId))
    if (Option.isNone(receipt)) return Option.none<string>()
    if (receipt.value.inputDigest !== inputDigest || receipt.value.command !== 'generate')
      return yield* OperationConflict.make({})
    return Option.some(receipt.value.result)
  })

/** The words are checked like anything public: words that fail are never sent to a model. */
const checked = (parts: Parts, prompt: string) =>
  Effect.gen(function* () {
    const verdict = yield* parts.judge.judge({ texts: [prompt], pictures: [] }).pipe(Effect.mapError(unavailable))
    if (verdict.state === 'failed') return yield* PromptRefused.make({ reason: verdict.reason ?? 'other' })
  })

const read = (parts: Parts, job: JobRow) =>
  Effect.flatMap(stored(parts.store.picturesOf(job.id)), (pictures) => view(job, pictures))

/** Asking for pictures, and reading how they are going. */
export const generations = (parts: Parts) => ({
  /** One picture from the words, or a mood board of two to four. The credits are held before anything runs. */
  admit: Effect.fn('Styld.Generation.admit')(function* (kind: GenerationKind, boardId: BoardId, input: Generate) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(JSON.stringify([kind, boardId, input.prompt]))
    const earlier = yield* replayed(parts, accountId, input.operationId, inputDigest)
    if (Option.isSome(earlier))
      return yield* get(parts, earlier.value).pipe(
        Effect.catchTag('GenerationNotFound', () => Effect.fail(unavailable())),
      )
    const board = yield* parts.boards
      .getBoard(boardId)
      .pipe(Effect.catchTag('WardrobeUnavailable', () => Effect.fail(unavailable())))
    const id = yield* parts.newId()
    // Credits first, so an account with none left asks no model anything.
    const { held, limit } = yield* holdUpTo(parts, accountId, id, kind === 'picture' ? 1 : mostMoodPictures)
    if (held < (kind === 'picture' ? 1 : fewestMoodPictures)) {
      yield* refund(parts, accountId, id, 0, held)
      return yield* Option.getOrElse(limit, () => DailyLimitReached.make({ resetsAt: '' }))
    }
    yield* checked(parts, input.prompt).pipe(Effect.tapError(() => refund(parts, accountId, id, 0, held)))
    const at = yield* nowDate
    const job: JobRow = {
      id,
      accountId,
      boardId,
      kind,
      prompt: input.prompt,
      status: kind === 'picture' ? 'drawing' : 'planning',
      reason: null,
      held,
      collageVersion: board.version,
      picks: [],
      moods: [],
      createdAt: at,
      updatedAt: at,
    }
    const pictures =
      kind === 'picture'
        ? [
            {
              jobId: id,
              index: 0,
              prompt: paintPrompt(input.prompt, false),
              references: [],
              status: 'waiting' as const,
              imageId: null,
              startedAt: null,
            },
          ]
        : []
    const receipt = {
      accountId,
      operationId: input.operationId,
      command: 'generate',
      inputDigest,
      result: id,
      createdAt: at,
    }
    yield* stored(parts.store.insertJob(job, pictures, receipt)).pipe(
      Effect.tapError(() => refund(parts, accountId, id, 0, held)),
    )
    // A job that could not be queued would wait for someone to read it: it is given up at once, its credits back.
    const queued = yield* Effect.result(send(parts, id))
    if (Result.isFailure(queued)) {
      yield* giveUp(parts, id).pipe(Effect.ignore({ log: true, message: 'Styld.Generation could not queue a job' }))
      return yield* get(parts, id).pipe(Effect.catchTag('GenerationNotFound', () => Effect.fail(unavailable())))
    }
    return yield* view(job, pictures)
  }),
  get: (jobId: string) => get(parts, jobId),
})

/** A job of the account's; one stalled on its way is sent again. */
const get = Effect.fn('Styld.Generation.get')(function* (parts: Parts, jobId: string) {
  const { accountId } = yield* CurrentAccount
  const job = yield* stored(parts.store.findJob(accountId, jobId))
  if (Option.isNone(job)) return yield* GenerationNotFound.make({})
  const finished = ['done', 'refused', 'failed'].includes(job.value.status)
  const at = yield* nowDate
  if (!finished && at.getTime() - job.value.updatedAt.getTime() > stalledMillis)
    yield* send(parts, jobId).pipe(Effect.ignore)
  return yield* read(parts, job.value)
})
