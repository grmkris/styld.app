import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Effect } from 'effect'
import StyldWorker from '@styld/server/StyldWorker'

/** Isolated v2 stack. The worker's stable URL is the only output used by acceptance tests. */
export default Alchemy.Stack(
  'StyldAppV2',
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const api = yield* StyldWorker
    const website = yield* Cloudflare.Website.Foldkit('StyldWebsite', {
      rootDir: 'apps/web',
      env: { API: api },
      workersDev: true,
    })
    return { apiUrl: api.url.as<string>(), url: website.url.as<string>() }
  }),
)
