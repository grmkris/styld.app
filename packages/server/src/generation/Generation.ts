import {
  type BoardId,
  CurrentAccount,
  type Generate,
  type GenerationKind,
  NotFound,
  Unavailable,
} from '@styld/protocol'
import { Effect, Option } from 'effect'
import { nowDate, stored } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'
import { type GenerationServices, send, view } from './Shared.ts'
import { stickerKey, stickerPrompt } from './PaintPrompt.ts'
import { GenerationStore, type JobRow, type StickerRow } from './Store.ts'
import { firstJobState } from './JobLifecycle.ts'
import { Boards } from '../boards/Boards.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { admitJob } from './Admission.ts'

/** A job not finished and not touched for this long lost its message: reading it sends it again. */
const stalledMillis = 3 * 60 * 1000

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
    status: firstJobState,
    reason: null,
    collageVersion: version,
    moods: [],
    createdAt: at,
    updatedAt: at,
  }
  const sticker: ReadonlyArray<StickerRow> =
    kind === 'sticker'
      ? [
          {
            jobId: id,
            prompt: stickerPrompt(input.prompt, stickerKey(input.prompt)),
            status: 'waiting',
            imageId: null,
            startedAt: null,
          },
        ]
      : []
  return { job, sticker }
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

/** Finish admission left behind by a lost request, then put runnable work back on the queue. */
const resume = Effect.fnUntraced(function* (job: JobRow, operationId: string) {
  if (job.status === 'admitting') {
    yield* admitJob(job, operationId)
    yield* send(job.id).pipe(Effect.ignore)
  }
  return yield* get(job.id).pipe(Effect.catchTag('NotFound', () => Effect.fail(Unavailable.make({}))))
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
    const receipt = yield* stored(store.findReceipt(accountId, input.operationId))
    const earlier = yield* priorResult(operation, receipt)
    if (Option.isSome(earlier)) {
      const job = yield* stored(store.findJob(accountId, earlier.value))
      if (Option.isNone(job)) return yield* Unavailable.make({})
      return yield* resume(job.value, input.operationId)
    }
    // A new ask, from the website, an assistant or Styld, at the account's pace.
    yield* (yield* Pacing).account('generate')
    const board = yield* (yield* Boards).getBoard(boardId)
    const { job, sticker } = yield* newJob(kind, boardId, input, board.version)
    // The job's queue deliveries and its reads record the same job id, so the ask, its work and its polls join.
    yield* Effect.annotateCurrentSpan('styld.job_id', job.id)
    yield* stored(store.insertJob(job, sticker, yield* receiptRow(operation, job.id)))
    yield* admitJob(job, input.operationId)
    yield* send(job.id).pipe(Effect.ignore)
    return yield* get(job.id)
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
