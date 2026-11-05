import { type Duration, Effect, Schedule } from 'effect'
import { type CaptureMetrics, counted, type ProviderCall } from '../kernel/Metrics.ts'
import { busy, isBusy, isOutcomeUnknown, outcomeUnknown, type ProviderError } from './Errors.ts'

// One provider call, made one way: within its deadline, tried again only while the provider says it is busy (it did
// not take the work), and counted with what it cost. A call past its deadline that is not replay-safe may have been
// taken and billed, so its outcome is unknown and it is never sent again; a replay-safe one was only slow.

/** Each kind of call's deadline, in one table. */
export const deadlines = {
  /** Clef answers a few questions about one picture in about a second. */
  clef: '30 seconds',
  /** Text safety shares the complete content check's twenty-second patience. */
  guard: '20 seconds',
  /** Cloudflare Images transforms one picture. */
  images: '30 seconds',
  /** SAM on one still. */
  segment: '90 seconds',
  /** Uploading a video of up to 95 MB to Meta. */
  upload: '5 minutes',
  /** SAM tracking a minute of video. */
  track: '10 minutes',
  /** Muse Image draws one picture in 20 to 60 s. */
  draw: '90 seconds',
  /** Starting a Veo job, and asking where one stands. */
  turn: '60 seconds',
  status: '30 seconds',
  /** One chat model call, or a plan's or Thinking's. Muse Spark at minimal thinking answered the probe of 5 November
   * (`tools/text-live.ts`) in 2.5 s for a plan and 8.6 s for Thinking at the median, the slowest in 15 s; one
   * Workers AI call that never answered once held a reply 235 s. */
  chat: '45 seconds',
} satisfies Readonly<Record<string, Duration.Input>>

/** How a busy provider is tried again: three more times, backing off from 400 ms. */
const whileBusy = { schedule: Schedule.exponential('400 millis'), times: 3, while: isBusy }

export interface CallSpec {
  readonly provider: ProviderCall['provider']
  readonly model: string
  readonly kind: ProviderCall['kind']
  readonly deadline: Duration.Input
  /** Whether sending it again could not pay twice: a question, a transform, a status. */
  readonly replaySafe: boolean
}

const outcomeOf = (error: ProviderError) => (isOutcomeUnknown(error) ? ('unknown' as const) : ('failed' as const))

/** One provider call: deadlined, retried while busy, counted with its units and cost. */
export const providerCall = <A, R>(
  metrics: CaptureMetrics['Service'],
  spec: CallSpec,
  call: Effect.Effect<A, ProviderError, R>,
  units: (value: A) => { readonly units: number; readonly costMicroUsd: number },
) =>
  counted(
    metrics,
    call.pipe(
      Effect.timeoutOrElse({
        duration: spec.deadline,
        orElse: () => Effect.fail(spec.replaySafe ? busy(spec.provider) : outcomeUnknown(spec.provider)),
      }),
      Effect.retry(whileBusy),
    ),
    { provider: spec.provider, model: spec.model, kind: spec.kind },
    units,
    outcomeOf,
  )
