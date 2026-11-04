import * as Cloudflare from '@alchemy.run/cloudflare'
import type { Environment } from '@styld/observability'
import type { Input } from 'alchemy/Input'
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
  /** Dodo Payments' API for its payments (test or live mode) and the Styld Premium Week product there
   * (`server/src/billing/`); payments run only where the stack is also given Dodo's key and webhook secret. */
  readonly billing: { readonly base: string; readonly product: string }
}

/** Dodo's test mode: test cards, no money moves. */
const dodoTest = { base: 'https://test.dodopayments.com', product: 'pdt_0NrETRIgUh3xrUyRjyEj0' } as const
/** Dodo's live mode, for styld.app only. */
const dodoLive = { base: 'https://live.dodopayments.com', product: 'pdt_0NrETRRmmoZUYS2pDknTg' } as const

/**
 * Every stage the stack is deployed or run as (docs/DEPLOYMENT.md). `preview` is the isolated workers.dev preview;
 * `production` is defined for the cutover and is not created before it; `local` (`alchemy dev`) and `local-native` (the
 * native suite) run in workerd on this machine. Any other stage name stops the plan.
 */
export const stages = {
  local: {
    environment: 'local',
    robots: 'noindex',
    aiCalls: 'styld_local_ai_calls',
    firstRateLimitNamespace: 2619001,
    billing: dodoTest,
  },
  'local-native': {
    environment: 'local',
    robots: 'noindex',
    aiCalls: 'styld_local_ai_calls',
    firstRateLimitNamespace: 2619101,
    billing: dodoTest,
  },
  preview: {
    environment: 'preview',
    robots: 'noindex',
    aiCalls: 'styld_preview_ai_calls',
    firstRateLimitNamespace: 2610281,
    billing: dodoTest,
  },
  production: {
    environment: 'production',
    robots: 'index',
    aiCalls: 'styld_production_ai_calls',
    firstRateLimitNamespace: 2611001,
    billing: dodoLive,
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

/** Wardrobes brought over from v1 at the switch (`imports/`), one piece a delivery at a pace Cloudflare Images keeps. */
export const StyldImportQueue = Cloudflare.Queues.Queue('StyldV2Imports')

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

/** How the Worker that hosts the chats' Thread Objects is deployed (`stylist/ThreadWorker.ts`; the native suite runs one
 * over a fake model): no public URL. Its `env` binds its Objects' own namespace (`stylistThreadObjects`), the API
 * Worker as `STYLD_API` for tool calls and settlements, and the model route's address and key. */
export const stylistThreadWorker = {
  compatibility: { date: '2026-10-19', flags: ['nodejs_compat'] },
  workersDev: { enabled: false, previewsEnabled: false },
  observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: true } },
}

/** The Thread Objects' SQLite namespace, in the Thread Worker that exports their class. */
export const stylistThreadObjects = Cloudflare.DurableObject('StylistThreads', { className: 'StylistThread' })

/** The Thread Worker as the API Worker binds it (`STYLIST_THREADS`): its entrypoint, which reaches the Objects
 * through the Thread Worker's own namespace. A binding of its own, made once both Workers exist: the two bind each
 * other. */
export const stylistThreadsOf = (threadWorker: { readonly workerName: Input<string> }) => ({
  bindings: [
    {
      type: 'service' as const,
      name: 'STYLIST_THREADS',
      service: threadWorker.workerName,
      entrypoint: 'StylistThreads',
    },
  ],
})
