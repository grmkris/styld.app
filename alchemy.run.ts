import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Config, Effect, Option } from 'effect'
import {
  currentStage,
  StyldAiCalls,
  StyldMedia,
  stylistThreadObjects,
  stylistThreadsOf,
  stylistThreadWorker,
} from '@styld/server/Resources'
import StyldWorkerLive, { StyldWorker } from '@styld/server/StyldWorker'

/** Isolated v2 stack, one per stage (`--stage preview`; `production` only at the cutover). The stage's name decides its
 * environment, robots, Analytics Engine dataset and rate-limit namespaces (`Resources.ts` `stages`). Its state lives in
 * the account's Cloudflare state store, so any operator's checkout plans against the same resources. The worker's
 * stable URL is the only output used by acceptance tests. */
export default Alchemy.Stack(
  'StyldAppV2',
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const release = yield* Config.String('STYLD_RELEASE')
    const stage = yield* currentStage
    // The media bucket; its name is what the v1 importer uploads bundles to (docs/DEPLOYMENT.md).
    const media = yield* StyldMedia
    const api = yield* StyldWorker
    // Styld's chats: each a Thread Object in this Worker, asking the chat model over Styld's own LiteLLM route.
    const threads = yield* Cloudflare.Worker('StyldStylistThreads', {
      ...stylistThreadWorker,
      main: 'packages/server/src/stylist/ThreadWorker.ts',
      env: {
        STYLD_API: api,
        STYLIST_THREADS: stylistThreadObjects,
        STYLD_ENV: stage.environment,
        STYLD_RELEASE: release,
        // Each chat model call is counted where every other provider call is (`kernel/Metrics.ts`).
        AI_CALLS: yield* StyldAiCalls,
        STYLD_LITELLM_URL: yield* Config.String('STYLD_LITELLM_URL'),
        STYLD_LITELLM_KEY: yield* Config.Redacted('STYLD_LITELLM_KEY'),
      },
    })
    yield* api.bind('StylistThreads', stylistThreadsOf(threads))
    const website = yield* Cloudflare.Website.Foldkit('StyldWebsite', {
      rootDir: 'apps/web',
      env: { VITE_STYLD_ENV: stage.environment, VITE_STYLD_RELEASE: release },
      compatibility: { date: '2026-10-19' },
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
      workersDev: { enabled: false, previewsEnabled: false },
    })
    const edge = yield* Cloudflare.Worker('StyldEdge', {
      main: 'packages/server/src/EdgeWorker.ts',
      // Every stage but production stays out of search engines; link previews still read its pages.
      env: { API: api, WEBSITE: website, ROBOTS: stage.robots },
      // Service-binding fetch enters the SSR handler without the website's
      // public asset router. Serve the same build's files at the public edge.
      assets: { directory: 'apps/web/dist/client' },
      compatibility: { date: '2026-10-19' },
      workersDev: true,
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
    })
    // The env seam unwraps Redacted values into secret_text. Raw binding
    // descriptors require strings and must never receive Config objects.
    yield* api.bind('RuntimeConfiguration', {
      env: {
        AUTH_ORIGIN: edge.url,
        STYLD_ENV: stage.environment,
        STYLD_RELEASE: release,
        AUTH_SECRET: yield* Config.Redacted('STYLD_AUTH_SECRET'),
        AUTH_SESSION_KEYS: yield* Config.Redacted('STYLD_AUTH_SESSION_KEYS'),
        AUTH_PROOF_KEYS: yield* Config.Redacted('STYLD_AUTH_PROOF_KEYS'),
        AUTH_REQUEST_BINDING_KEYS: yield* Config.Redacted('STYLD_AUTH_REQUEST_BINDING_KEYS'),
        // Meta's key, for SAM (cut-outs, videos) and Muse Image (clean pictures, stickers).
        META_API_KEY: yield* Config.Redacted('META_MUSE_API_KEY'),
        STYLD_LITELLM_URL: yield* Config.String('STYLD_LITELLM_URL'),
        STYLD_LITELLM_KEY: yield* Config.Redacted('STYLD_LITELLM_KEY'),
        // Accounts whose assistants get the curation tools (feature, house, hide, reports, checks): their sign-in
        // emails, comma-separated, from the owner's `.env.preview.local`; none when unset.
        STYLD_ADMIN_EMAILS: yield* Config.String('STYLD_ADMIN_EMAILS').pipe(Config.orElse(() => Config.succeed(''))),
        // The house accounts the operator's seed writes the inspiration boards into (`server/src/seed/`): their sign-in
        // emails, comma-separated; none when unset, so the seed refuses every account.
        STYLD_HOUSE_EMAILS: yield* Config.String('STYLD_HOUSE_EMAILS').pipe(Config.orElse(() => Config.succeed(''))),
        // Turns on a hanger: Veo 3.1 Lite through the Vercel AI Gateway. Until Styld has a gateway key of its own,
        // the owner chose the existing one (30 October); STYLD_AI_GATEWAY_API_KEY takes over once it is set.
        VIDEO_GATEWAY_API_KEY: yield* Config.Redacted('STYLD_AI_GATEWAY_API_KEY').pipe(
          Config.orElse(() => Config.Redacted('AI_GATEWAY_API_KEY')),
        ),
        // The operator's token, for administrative tasks from the operator's own tools such as the v1 importer
        // (`@styld/protocol` › Operator); without one the stage has no operator.
        ...Option.match(yield* Config.Redacted('STYLD_OPERATOR_TOKEN').pipe(Config.option), {
          onNone: () => ({}),
          onSome: (token) => ({ STYLD_OPERATOR_TOKEN: token }),
        }),
      },
    })
    return { url: edge.url.as<string>(), mediaBucket: media.bucketName.as<string>() }
  }).pipe(Effect.provide(StyldWorkerLive)),
)
