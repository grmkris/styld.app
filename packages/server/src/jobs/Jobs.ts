import type * as Cloudflare from '@alchemy.run/cloudflare'
import { type ObservabilityBase, withObservability } from '@styld/observability'
import { Cause, Effect, Exit, Option, Predicate, Schema } from 'effect'

// Every queue the API Worker consumes, and the one way its deliveries settle. A body is one case of the queue's tagged
// union; each case names the work that runs on a delivery and what giving up on it does. A delivery that worked is
// acknowledged; one that failed is retried until its last attempt, which gives the work up (the row moves to a
// terminal state and its credits come back through `metered`/`Holds`); a body that is no case of the queue is dropped.
// Each delivery writes one structured log line, and is its own span with the job it carries.

/** The queues the API Worker consumes. */
export type QueueName = 'pieces' | 'checks' | 'generation' | 'stylist'

/** A queue body: one tagged case of its union. */
export interface Tagged {
  readonly _tag: string
}

/** A queue: its name, its body's tagged union, how many times a job runs before it is given up, and the job id a
 * delivery records (a generation job, a Styld turn, a checked target). */
export interface JobQueue<Body extends Tagged> {
  readonly name: QueueName
  readonly body: Schema.Decoder<Body>
  /** Deliveries that run the work; one more delivery may follow only to give it up. */
  readonly attempts: number
  readonly batchSize: number
  readonly retryDelay: `${number} seconds`
  readonly jobOf: (body: Body) => Option.Option<string>
}

export const defineQueue = <Body extends Tagged>(queue: JobQueue<Body>) => queue

/** What Cloudflare is told: `maxRetries` counts retries after the first delivery, so the queue delivers `attempts`
 * times to run the work and once more if giving it up failed. */
export const consumerSettings = (queue: Pick<JobQueue<Tagged>, 'attempts' | 'batchSize' | 'retryDelay'>) => ({
  batchSize: queue.batchSize,
  maxRetries: queue.attempts,
  retryDelay: queue.retryDelay,
})

/** One kind of job: the work a delivery runs (with its 1-based attempt), and what giving up on it does. */
export interface Job<Body> {
  readonly run: (body: Body, attempt: number) => Effect.Effect<unknown, unknown>
  readonly giveUp: (body: Body) => Effect.Effect<unknown, unknown>
}

/** A job for every case of the queue's body. */
export type JobsOf<Body extends Tagged> = {
  readonly [Tag in Body['_tag']]: Job<Extract<Body, { readonly _tag: Tag }>>
}

/** How a delivery ended. */
export type Outcome = 'done' | 'retry' | 'gave-up' | 'dropped'

/** How one delivery settled, and why when it failed. */
interface Settled {
  readonly outcome: Outcome
  readonly kind: string
  readonly cause?: string
}

/** Give a job up; if that fails, one more delivery tries again, unless this was it. */
const givenUp = <Body extends Tagged>(job: Job<Body>, body: Body, kind: string, spare: boolean) =>
  Effect.map(Effect.exit(job.giveUp(body)), (exit): Settled =>
    Exit.isSuccess(exit)
      ? { outcome: 'gave-up', kind }
      : { outcome: spare ? 'retry' : 'gave-up', kind, cause: Cause.pretty(exit.cause) },
  )

/** The job for a decoded body: the one its case's tag names. */
const jobFor = <Body extends Tagged>(jobs: JobsOf<Body>, body: Body): [string, Job<Body>] | undefined => {
  const entries: ReadonlyArray<[string, Job<Body>]> = Object.entries(jobs)
  return entries.find(([tag]) => Predicate.isTagged(body, tag))
}

/** Run one delivery and decide how it settles: the one policy every queue shares. */
export const settle = Effect.fnUntraced(function* <Body extends Tagged>(
  queue: JobQueue<Body>,
  jobs: JobsOf<Body>,
  body: unknown,
  attempt: number,
) {
  const decoded = Schema.decodeUnknownOption(queue.body)(body)
  const found = Option.isSome(decoded) ? jobFor(jobs, decoded.value) : undefined
  if (Option.isNone(decoded) || found === undefined) return { outcome: 'dropped', kind: 'unknown' } satisfies Settled
  const [kind, job] = found
  // Past the last attempt only the give-up runs: the work already had its tries.
  if (attempt > queue.attempts) return yield* givenUp(job, decoded.value, kind, false)
  const ran = yield* Effect.exit(job.run(decoded.value, attempt))
  if (Exit.isSuccess(ran)) return { outcome: 'done', kind } satisfies Settled
  if (attempt < queue.attempts) return { outcome: 'retry', kind, cause: Cause.pretty(ran.cause) } satisfies Settled
  return yield* givenUp(job, decoded.value, kind, true)
})

/** Consume one delivery of the queue: settled once, by `settle`, with one log line and a span of its own. */
export const consume =
  <Body extends Tagged>(queue: JobQueue<Body>, base: ObservabilityBase, jobs: JobsOf<Body>) =>
  (message: Cloudflare.Queues.Message) =>
    Effect.gen(function* () {
      const settled = yield* settle(queue, jobs, message.body, message.attempts)
      yield* Effect.sync(() => (settled.outcome === 'retry' ? message.retry() : message.ack()))
      const line = settled.cause === undefined ? Effect.logInfo('Styld.Job') : Effect.logWarning('Styld.Job')
      yield* line.pipe(
        Effect.annotateLogs({
          'styld.job.queue': queue.name,
          'styld.job.kind': settled.kind,
          'styld.job.outcome': settled.outcome,
          ...(settled.cause === undefined ? {} : { 'styld.job.cause': settled.cause }),
        }),
      )
    }).pipe(
      withObservability('styld.queue', {
        ...base,
        kind: `queue.${queue.name}`,
        jobId: Option.getOrElse(
          Option.flatMap(Schema.decodeUnknownOption(queue.body)(message.body), queue.jobOf),
          () => message.id,
        ),
        attempt: message.attempts,
      }),
    )
