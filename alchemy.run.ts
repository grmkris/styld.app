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
      env: { API: api, WEBSITE: website },
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
        DAILY_ALLOWANCE: '100',
        META_API_BASE: 'https://api.meta.ai',
        META_API_KEY: yield* Config.Redacted('META_MUSE_API_KEY'),
        // Clean pictures of kept cut-outs (docs/ROADMAP.md › Clean pictures): Clef judges, Meta Muse Image draws.
        CLEAN_PICTURES: 'muse',
      },
    })
    return { url: edge.url.as<string>() }
  }).pipe(Effect.provide(StyldWorkerLive)),
)
