import { Clock, Context, Effect, Layer } from 'effect'

/** One provider call, as Analytics Engine records it. Never an account, a prompt or a picture. */
export interface ProviderCall {
  readonly provider: 'clef' | 'cloudflare-images' | 'meta-sam' | 'meta-muse' | 'vercel-gateway' | 'litellm'
  readonly model: string
  readonly kind:
    | 'route'
    | 'suggest'
    | 'check'
    | 'normalise'
    | 'foreground'
    | 'segment'
    | 'upload'
    | 'track'
    | 'draw'
    | 'judge'
    | 'compare'
    | 'match'
    | 'chat'
    | 'profile'
    | 'turn'
    | 'plan'
    | 'paint'
    | 'tryOn'
    | 'outfit'
    | 'propose'
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

/** Where a clean picture ended, who drew it (`none` when nothing was drawn), and whether its owner asked for it. */
export interface PictureOutcome {
  readonly state: 'ready' | 'proposed' | 'rejected' | 'retake' | 'kept-real' | 'failed'
  readonly provider: string
  /** A first drawing of the front, one the person asked to redraw, or a back's (from 4 November). */
  readonly kind: 'first' | 'redraw' | 'back'
}

/** The outfit engine's experiment (owner, 2026-10-31): each batch made, and each proposal kept (worn today or kept on a
 * board), by the way that made it. A run of makes without a keep is an abandoned one. Never an account or a piece. */
export type OutfitEvent =
  | {
      readonly phase: 'make'
      readonly mode: 'fast' | 'thinking'
      readonly session: string
      /** `ok` with proposals, `empty` when the rules had none left, `failed` when none could be made. */
      readonly outcome: 'ok' | 'empty' | 'failed'
      /** Whether Clef ranked the batch. */
      readonly judged: boolean
      readonly milliseconds: number
      readonly proposals: number
      readonly costMicroUsd: number
    }
  | {
      readonly phase: 'keep'
      readonly mode: 'fast' | 'thinking'
      readonly session: string
      readonly outcome: 'worn' | 'kept'
      /** Where in the run the kept proposal was shown, from 0, and whether the person changed it first. */
      readonly position: number
      readonly edited: boolean
    }

/** Where provider calls, review decisions, clean pictures' ends and outfits are counted (Workers Analytics Engine). */
export class CaptureMetrics extends Context.Service<
  CaptureMetrics,
  {
    readonly call: (call: ProviderCall) => Effect.Effect<void>
    readonly review: (decision: ReviewDecision) => Effect.Effect<void>
    readonly picture: (outcome: PictureOutcome) => Effect.Effect<void>
    readonly outfit: (event: OutfitEvent) => Effect.Effect<void>
  }
>()('@styld/server/CaptureMetrics') {
  /** For tests and for runs without a dataset. */
  static readonly discarding = {
    call: () => Effect.void,
    review: () => Effect.void,
    picture: () => Effect.void,
    outfit: () => Effect.void,
  }
  static readonly discard = Layer.succeed(this, this.discarding)
}

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
 * `tools/ai-usage-report.ts`. Calls: index `call.<provider>.<kind>`, blobs (environment, release,
 * provider, model, kind, outcome), doubles (milliseconds, units, cost in micro-dollars). Reviews: index
 * `review.<decision>`, blobs (environment, release, route, provider, decision). Pictures: index `picture.<state>`,
 * blobs (environment, release, state, provider, `redraw` or `first`). Outfits: index `outfit.<phase>.<mode>`, blobs
 * (environment, release, phase, mode, outcome, session, `judged`/`unjudged` or `edited`/`as-proposed`), doubles (a
 * make's milliseconds, proposals and cost in micro-dollars; a keep's position). Analytics Engine samples
 * per index, so a rare call (a route, a video track) keeps its own index rather than sharing one with
 * the bursts of thumbnails and suggestions a capture makes. A dataset that refuses a point never fails
 * the work it describes. */
export const analyticsEngine = (
  dataset: AnalyticsDataset,
  origin: { readonly environment: string; readonly release: string },
): CaptureMetrics['Service'] => ({
  call: (call) =>
    Effect.try(() =>
      dataset.writeDataPoint({
        indexes: [`call.${call.provider}.${call.kind}`],
        blobs: [origin.environment, origin.release, call.provider, call.model, call.kind, call.outcome],
        doubles: [call.milliseconds, call.units, call.costMicroUsd],
      }),
    ).pipe(Effect.ignore),
  review: (decision) =>
    Effect.try(() =>
      dataset.writeDataPoint({
        indexes: [`review.${decision.decision}`],
        blobs: [origin.environment, origin.release, decision.route, decision.provider, decision.decision],
        doubles: [1],
      }),
    ).pipe(Effect.ignore),
  picture: (outcome) =>
    Effect.try(() =>
      dataset.writeDataPoint({
        indexes: [`picture.${outcome.state}`],
        blobs: [origin.environment, origin.release, outcome.state, outcome.provider, outcome.kind],
        doubles: [1],
      }),
    ).pipe(Effect.ignore),
  outfit: (event) =>
    Effect.try(() =>
      dataset.writeDataPoint({
        indexes: [`outfit.${event.phase}.${event.mode}`],
        blobs: [
          origin.environment,
          origin.release,
          event.phase,
          event.mode,
          event.outcome,
          event.session,
          event.phase === 'make' ? (event.judged ? 'judged' : 'unjudged') : event.edited ? 'edited' : 'as-proposed',
        ],
        doubles: event.phase === 'make' ? [event.milliseconds, event.proposals, event.costMicroUsd] : [event.position],
      }),
    ).pipe(Effect.ignore),
})
