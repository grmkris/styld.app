import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Config, Effect } from 'effect'
import { StyldMedia } from '@styld/server/Resources'
import StyldWorkerLive, { StyldWorker } from '@styld/server/StyldWorker'

/** Isolated v2 stack. The worker's stable URL is the only output used by acceptance tests. */
export default Alchemy.Stack(
  'StyldAppV2',
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const release = yield* Config.String('STYLD_RELEASE')
    // The stack owns the media bucket even while no Worker serves media yet.
    yield* StyldMedia
    const api = yield* StyldWorker
    const website = yield* Cloudflare.Website.Foldkit('StyldWebsite', {
      rootDir: 'apps/web',
      env: { VITE_STYLD_ENV: 'preview', VITE_STYLD_RELEASE: release },
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
      // The preview stays out of search engines; link previews still read its pages.
      env: { API: api, WEBSITE: website, ROBOTS: 'noindex' },
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
        STYLD_ENV: 'preview',
        STYLD_RELEASE: release,
        AUTH_SECRET: yield* Config.Redacted('STYLD_AUTH_SECRET'),
        AUTH_SESSION_KEYS: yield* Config.Redacted('STYLD_AUTH_SESSION_KEYS'),
        AUTH_PROOF_KEYS: yield* Config.Redacted('STYLD_AUTH_PROOF_KEYS'),
        AUTH_REQUEST_BINDING_KEYS: yield* Config.Redacted('STYLD_AUTH_REQUEST_BINDING_KEYS'),
        // Capture providers (docs/ROADMAP.md › Iteration 1): Clef routes, Cloudflare cuts out one garment,
        // Meta SAM splits several and tracks videos. `CUTOUT_SINGLE=sam` sends single garments to SAM too.
        STYLD_PROVIDERS: 'live',
        CUTOUT_SINGLE: 'cloudflare',
        // Raised for a day (owner, 2026-11-01) while Eva's 313 carried-over pieces go through the cut-out step, a credit each.
        DAILY_ALLOWANCE: '400',
        META_API_BASE: 'https://api.meta.ai',
        META_API_KEY: yield* Config.Redacted('META_MUSE_API_KEY'),
        // Clean pictures of kept cut-outs (docs/ROADMAP.md › Clean pictures): Clef judges, Meta Muse Image draws.
        CLEAN_PICTURES: 'muse',
        // Generated pictures and mood boards for boards (M7): Meta Muse Image paints, a Workers AI model plans.
        GENERATED_PICTURES: 'muse',
        // Outfits from the person's own pieces (owner, 2026-10-31): Clef ranks; Thinking asks a Workers AI model.
        OUTFITS: 'live',
        // What people make public is checked by Clef-flash (pictures) and Llama Guard 3 (words) before others see it.
        CHECKS: 'live',
        // Accounts whose assistants get the curation tools (feature, house, hide, reports, checks): their sign-in
        // emails, comma-separated, from the owner's `.env.preview.local`; none when unset.
        STYLD_ADMIN_EMAILS: yield* Config.String('STYLD_ADMIN_EMAILS').pipe(Config.orElse(() => Config.succeed(''))),
        // Styld, the stylist in the app (31 October): GLM-5.3-flash on Workers AI through the Worker's binding. The
        // Vercel AI Gateway (STYLIST=gateway, with STYLIST_GATEWAY_API_KEY) answers with Claude Haiku 5.5 instead.
        STYLIST: 'workers-ai',
        // Turns on a hanger: Veo 3.1 Lite through the Vercel AI Gateway. Until Styld has a gateway key of its own,
        // the owner chose the existing one (30 October); STYLD_AI_GATEWAY_API_KEY takes over once it is set.
        TURNS: 'veo',
        VIDEO_GATEWAY_API_KEY: yield* Config.Redacted('STYLD_AI_GATEWAY_API_KEY').pipe(
          Config.orElse(() => Config.Redacted('AI_GATEWAY_API_KEY')),
        ),
      },
    })
    return { url: edge.url.as<string>() }
  }).pipe(Effect.provide(StyldWorkerLive)),
)
