import { authMirror } from '@styld/db'
import { lt } from 'drizzle-orm'
import { DateTime, Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { Deployment } from './Config.ts'
import { health } from './Health.ts'
import { landingMediaRoute } from './LandingMedia.ts'
import { Database, query } from './kernel/Db.ts'
import { module } from './kernel/Module.ts'
import { Media } from './kernel/Media.ts'
import { owedMedia, sweepOwed } from './kernel/MediaDeletions.ts'
import { Pacing } from './kernel/Pacing.ts'
import { forgetOldReceipts } from './kernel/Receipts.ts'
import { Holds } from './usage/Holds.ts'
import type { Sweep } from './jobs/Sweeps.ts'

/** Receipts go a larger batch at a time: deleting them is one statement. */
const forgetBatch = 500

/** Google sign-ins that never came back: each lives five minutes, then its row is only clutter. */
const forgetGoogleFlows = Effect.gen(function* () {
  const db = yield* Database
  const now = DateTime.toEpochMillis(yield* DateTime.now)
  const { oauthSignInFlows } = authMirror
  const gone = yield* query(() => db.delete(oauthSignInFlows).where(lt(oauthSignInFlows.expiresAt, now)))
  return gone.meta.changes
})

const sweeps: ReadonlyArray<Sweep<Database | Holds | Media>> = [
  { name: 'receipts', run: Effect.flatMap(Database, (db) => forgetOldReceipts(db, forgetBatch)) },
  { name: 'googleSignIns', run: forgetGoogleFlows },
  { name: 'settlements', run: Effect.flatMap(Holds, (holds) => holds.sweep) },
  // Deleted pieces' and photos' prefixes R2 could not empty at once (`kernel/MediaDeletions.ts`).
  {
    name: 'mediaDeletions',
    run: Effect.flatMap(Database, (db) => Effect.flatMap(Media, ({ bucket }) => sweepOwed(owedMedia(db), bucket))),
  },
]

/** What every deployment serves besides its modules: health, the browser telemetry relay, the landing's films, forgetting receipts past
 * their lifetime and Google sign-ins never finished, emptying deleted rows' prefixes R2 could not empty at once, settling the credit holds the Wallet has not confirmed settled, and forgetting finished paid work. */
export const platform = module({
  layer: Layer.empty,
  routes: Layer.unwrap(
    Effect.gen(function* () {
      const { origin, release } = yield* Deployment
      const pacing = yield* Pacing
      return Layer.mergeAll(
        HttpRouter.add('GET', '/api/health', health(release)),
        browserTelemetryRoutes(origin, (network) => pacing.allows('telemetry', network)),
        yield* landingMediaRoute,
      )
    }),
  ),
  sweeps,
})
