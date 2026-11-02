import { Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { Deployment } from './Config.ts'
import { health } from './Health.ts'
import { Database } from './kernel/Db.ts'
import { module } from './kernel/Module.ts'
import { Pacing } from './kernel/Pacing.ts'
import { forgetOldReceipts } from './kernel/Receipts.ts'
import { PaidAttempts } from './usage/Attempts.ts'
import { Holds } from './usage/Holds.ts'
import type { Sweep } from './jobs/Sweeps.ts'

/** Receipts go a larger batch at a time: deleting them is one statement. */
const forgetBatch = 500

const sweeps: ReadonlyArray<Sweep<Database | Holds | PaidAttempts>> = [
  { name: 'receipts', run: Effect.flatMap(Database, (db) => forgetOldReceipts(db, forgetBatch)) },
  { name: 'settlements', run: Effect.flatMap(Holds, (holds) => holds.sweep) },
  { name: 'attempts', run: Effect.flatMap(PaidAttempts, (attempts) => attempts.sweep) },
]

/** What every deployment serves besides its modules: health, the browser telemetry relay, forgetting receipts past
 * their lifetime, settling the credit holds the Wallet has not confirmed settled, and forgetting finished paid work. */
export const platform = module({
  layer: Layer.empty,
  routes: Layer.unwrap(
    Effect.gen(function* () {
      const { origin, release } = yield* Deployment
      const pacing = yield* Pacing
      return Layer.mergeAll(
        HttpRouter.add('GET', '/api/health', health(release)),
        browserTelemetryRoutes(origin, (network) => pacing.allows('telemetry', network)),
      )
    }),
  ),
  sweeps,
})
