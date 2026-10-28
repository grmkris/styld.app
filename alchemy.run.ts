import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Config, Effect } from 'effect'
import StyldWorkerLive, { StyldWorker } from '@styld/server/StyldWorker'

/** Isolated v2 stack. The worker's stable URL is the only output used by acceptance tests. */
export default Alchemy.Stack(
  'StyldAppV2',
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const api = yield* StyldWorker
    const website = yield* Cloudflare.Website.Foldkit('StyldWebsite', {
      rootDir: 'apps/web',
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
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
    })
    // Alchemy's Worker resource alias currently erases its binding generic;
    // the runtime Resource.bind contract still accepts this provider payload.
    // @ts-expect-error -- upstream Worker<Bindings> omits Resource<..., Binding>.
    yield* api.bind('AUTH_ORIGIN', {
      bindings: [
        { type: 'plain_text', name: 'AUTH_ORIGIN', text: edge.url },
        { type: 'plain_text', name: 'STYLD_ENV', text: 'preview' },
        { type: 'plain_text', name: 'STYLD_RELEASE', text: 'preview' },
        {
          type: 'secret_text',
          name: 'AUTH_SECRET',
          text: Config.Redacted('STYLD_AUTH_SECRET'),
        },
        {
          type: 'secret_text',
          name: 'AUTH_SESSION_KEYS',
          text: Config.Redacted('STYLD_AUTH_SESSION_KEYS'),
        },
      ],
    })
    return { url: edge.url.as<string>() }
  }).pipe(Effect.provide(StyldWorkerLive)),
)
