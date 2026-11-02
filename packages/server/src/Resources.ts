import * as Cloudflare from '@alchemy.run/cloudflare'
import type { Environment } from '@styld/observability'
import { Stage } from 'alchemy/Stage'
import { Effect, Schema } from 'effect'

/** What a stage's name decides about its deployment. */
interface StageFacts {
  /** `STYLD_ENV` and `VITE_STYLD_ENV`: what logs, traces and the website call the deployment. */
  readonly environment: Environment
  /** Whether search engines may index its pages (the edge's `ROBOTS`); link previews read them either way. */
  readonly robots: 'index' | 'noindex'
  /** The Analytics Engine dataset its provider calls are counted in (`kernel/Metrics.ts`, `tools/ai-usage-report.ts`). */
  readonly aiCalls: string
  /** The first of its RateLimit namespace ids, each pace's offset from it (`kernel/Pacing.ts`); unique within the
   * Cloudflare account. */
  readonly firstRateLimitNamespace: number
}

/**
 * Every stage the stack is deployed or run as (docs/DEPLOYMENT.md). `preview` is the isolated workers.dev preview;
 * `production` is defined for the cutover and is not created before it; `local` (`alchemy dev`) and `local-native` (the
 * native suite) run in workerd on this machine. Any other stage name stops the plan.
 */
export const stages = {
  local: { environment: 'local', robots: 'noindex', aiCalls: 'styld_local_ai_calls', firstRateLimitNamespace: 2619001 },
  'local-native': {
    environment: 'local',
    robots: 'noindex',
    aiCalls: 'styld_local_ai_calls',
    firstRateLimitNamespace: 2619101,
  },
  preview: {
    environment: 'preview',
    robots: 'noindex',
    aiCalls: 'styld_preview_ai_calls',
    firstRateLimitNamespace: 2610281,
  },
  production: {
    environment: 'production',
    robots: 'index',
    aiCalls: 'styld_production_ai_calls',
    firstRateLimitNamespace: 2611001,
  },
} as const satisfies Record<string, StageFacts>

export type StageName = keyof typeof stages

export const isStageName = (stage: string): stage is StageName => Object.hasOwn(stages, stage)

/** A stage the table does not name: the plan stops. */
class UnknownStage extends Schema.TaggedError<UnknownStage>()('UnknownStage', {
  stage: Schema.String,
  known: Schema.Array(Schema.String),
}) {}

/** The facts of the stage being planned or run. */
export const currentStage = Effect.gen(function* () {
  const stage = yield* Stage
  if (!isStageName(stage)) return yield* Effect.die(new UnknownStage({ stage, known: Object.keys(stages) }))
  return stages[stage]
})

/**
 * v2 owns its Cloudflare data plane. These resources are intentionally named
 * independently from Styld v1 so preview deploys cannot adopt or mutate v1.
 */
export const StyldDatabase = Cloudflare.D1.Database('StyldV2Database', {
  migrations: 'packages/db/migrations',
})

export const StyldMedia = Cloudflare.R2.Bucket('StyldV2Media', {
  jurisdiction: 'eu',
})

/** New pieces wait here for their photo to be prepared (`wardrobe/Processing.ts`). */
export const StyldPieceQueue = Cloudflare.Queues.Queue('StyldV2PieceProcessing')

/** The model's checks of what people make public, retried while a model does not answer. */
export const StyldChecksQueue = Cloudflare.Queues.Queue('StyldV2Checks')

/** Generated pictures and mood boards on their way (`generation/Work.ts`), each step resumed where it stopped. */
export const StyldGenerationQueue = Cloudflare.Queues.Queue('StyldV2Generation')

/** Styld's replies on their way (`stylist/Queue.ts`), one at a time so each starts at once. */
export const StyldStylistQueue = Cloudflare.Queues.Queue('StyldV2Stylist')

/** Every capture provider call and review decision, for cost and keep rates (`tools/ai-usage-report.ts`). */
export const StyldAiCalls = Effect.flatMap(currentStage, ({ aiCalls }) =>
  Cloudflare.AnalyticsEngine.Dataset('StyldAiCalls', { dataset: aiCalls }),
)

/** Cloudflare Email Service's `send_email` binding, named `STYLD_EMAIL` in the Worker's env. The
 * styld.app sending domain is already set up in this account, so the stack declares no sending
 * domain or DNS record of its own. */
export const StyldEmail = Cloudflare.Email.SendEmail('STYLD_EMAIL', { allowedSenderAddresses: ['noreply@styld.app'] })

/** The sender every code email comes from. */
export const emailSender = 'Styld <noreply@styld.app>'
