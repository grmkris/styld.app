import { type BoardId, type Generate, type GenerationKind, NotFound, prices, PromptRefused } from '@styld/protocol'
import { Effect, Option, Result } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { stickerKey, stickerPrompt } from './PaintPrompt.ts'
import { jobHold, type Parts, send, unavailable, view } from './Parts.ts'
import { nowDate } from '../kernel/Db.ts'
import { giveUp } from './Work.ts'
import type { JobRow } from './Store.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'

/** A job not finished and not touched for this long lost its message: reading it sends it again. */
const stalledMillis = 3 * 60 * 1000

const stored = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, unavailable)

/** Give an ask's credit back: the job was never stored, or never queued. */
const refund = (parts: Parts, accountId: string, jobId: string) =>
  parts.holds
    .settle(accountId, jobHold(jobId), 'failed')
    .pipe(Effect.ignore({ log: true, message: 'Styld.Generation could not give a credit back' }))

/** Hold the ask's price: a sticker's, or a mood board's. */
const holdOne = (parts: Parts, accountId: string, jobId: string, kind: GenerationKind) =>
  parts.holds.reserve({ accountId, hold: jobHold(jobId), credits: prices[kind] }).pipe(
    // The Wallet may have taken it before its answer was lost.
    Effect.tapErrorTag('Unavailable', () => refund(parts, accountId, jobId)),
  )

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
  /** A sticker from the words, or a mood board of the person's pieces: its price held before anything runs. */
  admit: Effect.fn('Styld.Generation.admit')(function* (kind: GenerationKind, boardId: BoardId, input: Generate) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'generate',
      input: [kind, boardId, input.prompt],
    })
    const earlier = yield* priorResult(operation, yield* stored(parts.store.findReceipt(accountId, input.operationId)))
    if (Option.isSome(earlier))
      return yield* get(parts, earlier.value).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
    const board = yield* parts.boards.getBoard(boardId)
    const id = yield* newId('gj')
    // The job's queue deliveries and its reads record the same job id, so the ask, its work and its polls join.
    yield* Effect.annotateCurrentSpan('styld.job_id', id)
    // The credit first, so an account with none left asks no model anything.
    yield* holdOne(parts, accountId, id, kind)
    yield* checked(parts, input.prompt).pipe(Effect.tapError(() => refund(parts, accountId, id)))
    const at = yield* nowDate
    const job: JobRow = {
      id,
      accountId,
      boardId,
      kind,
      prompt: input.prompt,
      status: kind === 'sticker' ? 'drawing' : 'planning',
      reason: null,
      // Written for the column alone until the baseline drops it; the Wallet is the only record of a hold.
      held: 1,
      collageVersion: board.version,
      picks: [],
      moods: [],
      createdAt: at,
      updatedAt: at,
    }
    const pictures =
      kind === 'sticker'
        ? [
            {
              jobId: id,
              index: 0,
              prompt: stickerPrompt(input.prompt, stickerKey(input.prompt)),
              status: 'waiting' as const,
              imageId: null,
              startedAt: null,
            },
          ]
        : []
    yield* stored(parts.store.insertJob(job, pictures, yield* receiptRow(operation, id))).pipe(
      Effect.tapError(() => refund(parts, accountId, id)),
    )
    // A job that could not be queued would wait for someone to read it: it is given up at once, its credits back.
    const queued = yield* Effect.result(send(parts, id))
    if (Result.isFailure(queued)) {
      yield* giveUp(parts, id).pipe(Effect.ignore({ log: true, message: 'Styld.Generation could not queue a job' }))
      return yield* get(parts, id).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
    }
    return yield* view(job, pictures)
  }),
  get: (jobId: string) => get(parts, jobId),
  /** The board's ask still being made, read as `get` reads it, so one stalled on its way is sent again. */
  running: Effect.fn('Styld.Generation.running')(function* (boardId: BoardId) {
    const { accountId } = yield* CurrentAccount
    const job = yield* stored(parts.store.runningJob(accountId, boardId))
    if (Option.isNone(job)) return { generation: null }
    return yield* get(parts, job.value.id).pipe(
      Effect.map((generation) => ({ generation })),
      Effect.catchTag('NotFound', () => Effect.succeed({ generation: null })),
    )
  }),
})

/** A job of the account's; one stalled on its way is sent again. */
const get = Effect.fn('Styld.Generation.get')(function* (parts: Parts, jobId: string) {
  const { accountId } = yield* CurrentAccount
  yield* Effect.annotateCurrentSpan('styld.job_id', jobId)
  const job = yield* stored(parts.store.findJob(accountId, jobId))
  if (Option.isNone(job)) return yield* NotFound.make({})
  const finished = ['done', 'refused', 'failed'].includes(job.value.status)
  const at = yield* nowDate
  if (!finished && at.getTime() - job.value.updatedAt.getTime() > stalledMillis)
    yield* send(parts, jobId).pipe(Effect.ignore)
  return yield* read(parts, job.value)
})
