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
import { type GenerationServices, jobHold, send, stored, unavailable, view } from './Shared.ts'
import { stickerKey, stickerPrompt } from './PaintPrompt.ts'
import { GenerationStore, type JobRow, type StickerRow } from './Store.ts'
import { giveUp } from './Work.ts'
import { Boards } from '../boards/Boards.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { ContentJudge } from '../safety/Judge.ts'
import { Holds } from '../usage/Holds.ts'

/** A job not finished and not touched for this long lost its message: reading it sends it again. */
const stalledMillis = 3 * 60 * 1000

/** The words are checked like anything public: words that fail are never sent to a model. */
const checked = (prompt: string) =>
  Effect.gen(function* () {
    const verdict = yield* (yield* ContentJudge)
      .judge({ texts: [prompt], pictures: [] })
      .pipe(Effect.mapError(unavailable))
    if (verdict.state === 'failed') return yield* PromptRefused.make({ reason: verdict.reason ?? 'other' })
  })

const read = (job: JobRow) =>
  Effect.flatMap(stored(Effect.flatMap(GenerationStore, (store) => store.stickerOf(job.id))), (sticker) =>
    view(job, sticker),
  )

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
const held = (operation: Identified, job: JobRow) =>
  Effect.gen(function* () {
    const holds = yield* Holds
    const undo = stored((yield* GenerationStore).undoJob(job, operation.operationId)).pipe(
      Effect.ignore({ log: true, message: 'Styld.Generation could not undo a job' }),
    )
    const refundAndUndo = holds.settle(job.accountId, jobHold(job.id), 'failed').pipe(
      Effect.matchEffect({
        onSuccess: () => undo,
        onFailure: () => giveUp(job.id).pipe(Effect.ignore({ log: true, message: 'Styld.Generation lost a hold' })),
      }),
    )
    yield* holds.reserve({ accountId: job.accountId, hold: jobHold(job.id), credits: prices[job.kind] }).pipe(
      Effect.tapErrorTag('LimitReached', () => undo),
      Effect.tapErrorTag('Unavailable', () => giveUp(job.id).pipe(Effect.ignore)),
    )
    yield* checked(job.prompt).pipe(Effect.tapError(() => refundAndUndo))
  })

/** A job of the account's; one stalled on its way is sent again. */
const get = Effect.fn('Styld.Generation.get')(function* (jobId: string) {
  const { accountId } = yield* CurrentAccount
  yield* Effect.annotateCurrentSpan('styld.job_id', jobId)
  const job = yield* stored((yield* GenerationStore).findJob(accountId, jobId))
  if (Option.isNone(job)) return yield* NotFound.make({})
  const finished = ['done', 'refused', 'failed'].includes(job.value.status)
  const at = yield* nowDate
  if (!finished && at.getTime() - job.value.updatedAt.getTime() > stalledMillis) yield* send(jobId).pipe(Effect.ignore)
  return yield* read(job.value)
})

/** Asking for pictures, and reading how they are going. */
export const generations = Effect.map(Effect.context<GenerationServices>(), (context) => ({
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
    const store = yield* GenerationStore
    const earlier = yield* priorResult(operation, yield* stored(store.findReceipt(accountId, input.operationId)))
    if (Option.isSome(earlier))
      return yield* get(earlier.value).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
    // A new ask, from the website, an assistant or Styld, at the account's pace.
    yield* (yield* Pacing).account('generate')
    const board = yield* (yield* Boards).getBoard(boardId)
    const { job, sticker } = yield* newJob(kind, boardId, input, board.version)
    // The job's queue deliveries and its reads record the same job id, so the ask, its work and its polls join.
    yield* Effect.annotateCurrentSpan('styld.job_id', job.id)
    yield* stored(store.insertJob(job, sticker, yield* receiptRow(operation, job.id)))
    yield* held(operation, job)
    // A job that could not be queued would wait for someone to read it: it is given up at once, its credits back.
    const queued = yield* Effect.result(send(job.id))
    if (Result.isFailure(queued)) {
      yield* giveUp(job.id).pipe(Effect.ignore({ log: true, message: 'Styld.Generation could not queue a job' }))
      return yield* get(job.id).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
    }
    return yield* view(job, Option.fromNullishOr(sticker[0]))
  }, Effect.provide(context)),
  get: (jobId: string) => get(jobId).pipe(Effect.provide(context)),
  /** The board's ask still being made, read as `get` reads it, so one stalled on its way is sent again. */
  running: Effect.fn('Styld.Generation.running')(function* (boardId: BoardId) {
    const { accountId } = yield* CurrentAccount
    const job = yield* stored((yield* GenerationStore).runningJob(accountId, boardId))
    if (Option.isNone(job)) return { generation: null }
    return yield* get(job.value.id).pipe(
      Effect.map((generation) => ({ generation })),
      Effect.catchTag('NotFound', () => Effect.succeed({ generation: null })),
    )
  }, Effect.provide(context)),
}))
