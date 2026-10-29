import { Clock, Context, Effect, Layer } from 'effect'

/** One provider call, as Analytics Engine records it. Never an account, a prompt or a picture. */
export interface ProviderCall {
  readonly provider: 'clef' | 'cloudflare-images' | 'meta-sam'
  readonly model: string
  readonly kind: 'route' | 'suggest' | 'check' | 'normalise' | 'foreground' | 'segment' | 'upload' | 'track'
  readonly outcome: 'ok' | 'failed' | 'unknown'
  readonly milliseconds: number
  /** What the provider bills by: tokens, images or frames. */
  readonly units: number
  readonly costMicroUsd: number
}

/** One review decision on a detected piece. */
export interface ReviewDecision {
  readonly route: string
  readonly provider: string
  readonly decision: 'kept' | 'discarded' | 'original'
}

/** Where provider calls and review decisions are counted (Workers Analytics Engine). */
export class CaptureMetrics extends Context.Service<
  CaptureMetrics,
  {
    readonly call: (call: ProviderCall) => Effect.Effect<void>
    readonly review: (decision: ReviewDecision) => Effect.Effect<void>
  }
>()('@styld/server/CaptureMetrics') {
  /** For tests and for runs without a dataset. */
  static readonly discarding = { call: () => Effect.void, review: () => Effect.void }
  static readonly discard = Layer.succeed(this, this.discarding)
}

/** List prices in micro-dollars, read 2026-10-29 (`docs/ROADMAP.md` › Provider facts). Estimates only:
 * the providers' own invoices are the truth. */
export const prices = {
  clefFlashPerToken: 0.038,
  imagesPerTransform: 500,
  samPerImage: 2500,
  samPerFrame: 200,
} as const

/** Time `effect` and count it as one provider call, whatever its outcome. */
export const counted = <A, E, R>(
  metrics: CaptureMetrics['Service'],
  effect: Effect.Effect<A, E, R>,
  call: Omit<ProviderCall, 'outcome' | 'milliseconds' | 'units' | 'costMicroUsd'>,
  units: (value: A) => { readonly units: number; readonly costMicroUsd: number },
  outcomeOf: (error: E) => ProviderCall['outcome'] = () => 'failed',
) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    const elapsed = Clock.currentTimeMillis.pipe(Effect.map((now) => now - started))
    return yield* effect.pipe(
      Effect.tap((value) =>
        Effect.flatMap(elapsed, (milliseconds) =>
          metrics.call({ ...call, outcome: 'ok', milliseconds, ...units(value) }),
        ),
      ),
      Effect.tapError((error) =>
        Effect.flatMap(elapsed, (milliseconds) =>
          metrics.call({ ...call, outcome: outcomeOf(error), milliseconds, units: 0, costMicroUsd: 0 }),
        ),
      ),
    )
  })

/** The Analytics Engine dataset's write side: one data point per call, fire and forget. */
export interface AnalyticsDataset {
  writeDataPoint(point: {
    readonly indexes?: ReadonlyArray<string>
    readonly blobs?: ReadonlyArray<string>
    readonly doubles?: ReadonlyArray<number>
  }): void
}

/** Provider calls and review decisions as Analytics Engine data points, queried by
 * `tools/ai-usage-report.ts`. Calls: blobs (environment, release, provider, model, kind, outcome),
 * doubles (milliseconds, units, cost in micro-dollars). Reviews: blobs (environment, release, route,
 * provider, decision). A dataset that refuses a point never fails the work it describes. */
export const analyticsEngine = (
  dataset: AnalyticsDataset,
  origin: { readonly environment: string; readonly release: string },
): CaptureMetrics['Service'] => ({
  call: (call) =>
    Effect.sync(() =>
      dataset.writeDataPoint({
        indexes: ['call'],
        blobs: [origin.environment, origin.release, call.provider, call.model, call.kind, call.outcome],
        doubles: [call.milliseconds, call.units, call.costMicroUsd],
      }),
    ).pipe(Effect.ignore),
  review: (decision) =>
    Effect.sync(() =>
      dataset.writeDataPoint({
        indexes: ['review'],
        blobs: [origin.environment, origin.release, decision.route, decision.provider, decision.decision],
        doubles: [1],
      }),
    ).pipe(Effect.ignore),
})
