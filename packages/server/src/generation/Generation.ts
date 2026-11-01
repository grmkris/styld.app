import {
  type BoardId,
  CurrentAccount,
  type Generate,
  type GenerationKind,
  NotFound,
  prices,
  PromptRefused,
} from '@styld/protocol'
import { Effect, Option, Result } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { type Identified, identify, priorResult, receiptRow } from '../kernel/Receipts.ts'
import { type Deps, jobHold, send, stored, unavailable, view } from './Deps.ts'
import { stickerKey, stickerPrompt } from './PaintPrompt.ts'
import type { JobRow, StickerRow } from './Store.ts'
import { giveUp } from './Work.ts'

/** A job not finished and not touched for this long lost its message: reading it sends it again. */
const stalledMillis = 3 * 60 * 1000

/** The words are checked like anything public: words that fail are never sent to a model. */
const checked = (deps: Deps, prompt: string) =>
  Effect.gen(function* () {
    const verdict = yield* deps.judge.judge({ texts: [prompt], pictures: [] }).pipe(Effect.mapError(unavailable))
    if (verdict.state === 'failed') return yield* PromptRefused.make({ reason: verdict.reason ?? 'other' })
  })

const read = (deps: Deps, job: JobRow) =>
  Effect.flatMap(stored(deps.store.stickerOf(job.id)), (sticker) => view(job, sticker))

/** The job and, for a sticker, its picture, as first written. */
const newJob = Effect.fnUntraced(function* (kind: GenerationKind, boardId: BoardId, input: Generate, version: number) {
  const { accountId } = yield* CurrentAccount
  const id = yield* newId('gj')
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
    collageVersion: version,
    picks: [],
    moods: [],
    createdAt: at,
    updatedAt: at,
  }
  const sticker: ReadonlyArray<StickerRow> =
    kind === 'sticker'
      ? [
          {
            jobId: id,
            // Written for the column alone until the baseline drops it: a job has one sticker.
            index: 0,
            prompt: stickerPrompt(input.prompt, stickerKey(input.prompt)),
            status: 'waiting',
            imageId: null,
            startedAt: null,
          },
        ]
      : []
  return { job, sticker }
})

/** The job's credit, held once its row is there, so every hold has a row whose status settles it; then its words
 * checked. Past the daily limit, or with words that fail the check, the job is undone (its credit given back first)
 * and the same operation may ask again; a Wallet that did not answer leaves the job failed, which gives it back. */
const held = (deps: Deps, operation: Identified, job: JobRow) =>
  Effect.gen(function* () {
    const undo = stored(deps.store.undoJob(job, operation.operationId)).pipe(
      Effect.ignore({ log: true, message: 'Styld.Generation could not undo a job' }),
    )
    const refundAndUndo = deps.holds.settle(job.accountId, jobHold(job.id), 'failed').pipe(
      Effect.matchEffect({
        onSuccess: () => undo,
        onFailure: () =>
          giveUp(deps, job.id).pipe(Effect.ignore({ log: true, message: 'Styld.Generation lost a hold' })),
      }),
    )
    yield* deps.holds.reserve({ accountId: job.accountId, hold: jobHold(job.id), credits: prices[job.kind] }).pipe(
      Effect.tapErrorTag('LimitReached', () => undo),
      Effect.tapErrorTag('Unavailable', () => giveUp(deps, job.id).pipe(Effect.ignore)),
    )
    yield* checked(deps, job.prompt).pipe(Effect.tapError(() => refundAndUndo))
  })

/** A job of the account's; one stalled on its way is sent again. */
const get = Effect.fn('Styld.Generation.get')(function* (deps: Deps, jobId: string) {
  const { accountId } = yield* CurrentAccount
  yield* Effect.annotateCurrentSpan('styld.job_id', jobId)
  const job = yield* stored(deps.store.findJob(accountId, jobId))
  if (Option.isNone(job)) return yield* NotFound.make({})
  const finished = ['done', 'refused', 'failed'].includes(job.value.status)
  const at = yield* nowDate
  if (!finished && at.getTime() - job.value.updatedAt.getTime() > stalledMillis)
    yield* send(deps, jobId).pipe(Effect.ignore)
  return yield* read(deps, job.value)
})

/** Asking for pictures, and reading how they are going. */
export const generations = (deps: Deps) => ({
  /** A sticker from the words, or a mood board of the person's pieces, at the account's pace: its price held before
   * anything runs. */
  admit: Effect.fn('Styld.Generation.admit')(function* (kind: GenerationKind, boardId: BoardId, input: Generate) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'generate',
      input: [kind, boardId, input.prompt],
    })
    const earlier = yield* priorResult(operation, yield* stored(deps.store.findReceipt(accountId, input.operationId)))
    if (Option.isSome(earlier))
      return yield* get(deps, earlier.value).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
    // A new ask, from the website, an assistant or Styld, at the account's pace.
    yield* deps.pacing.account('generate')
    const board = yield* deps.boards.getBoard(boardId)
    const { job, sticker } = yield* newJob(kind, boardId, input, board.version)
    // The job's queue deliveries and its reads record the same job id, so the ask, its work and its polls join.
    yield* Effect.annotateCurrentSpan('styld.job_id', job.id)
    yield* stored(deps.store.insertJob(job, sticker, yield* receiptRow(operation, job.id)))
    yield* held(deps, operation, job)
    // A job that could not be queued would wait for someone to read it: it is given up at once, its credits back.
    const queued = yield* Effect.result(send(deps, job.id))
    if (Result.isFailure(queued)) {
      yield* giveUp(deps, job.id).pipe(Effect.ignore({ log: true, message: 'Styld.Generation could not queue a job' }))
      return yield* get(deps, job.id).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
    }
    return yield* view(job, Option.fromNullishOr(sticker[0]))
  }),
  get: (jobId: string) => get(deps, jobId),
  /** The board's ask still being made, read as `get` reads it, so one stalled on its way is sent again. */
  running: Effect.fn('Styld.Generation.running')(function* (boardId: BoardId) {
    const { accountId } = yield* CurrentAccount
    const job = yield* stored(deps.store.runningJob(accountId, boardId))
    if (Option.isNone(job)) return { generation: null }
    return yield* get(deps, job.value.id).pipe(
      Effect.map((generation) => ({ generation })),
      Effect.catchTag('NotFound', () => Effect.succeed({ generation: null })),
    )
  }),
})
