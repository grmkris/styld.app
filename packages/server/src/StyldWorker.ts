import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { decodeAuthSecret, decodeAuthSessionKeyring, makeAuthHttp } from './AuthHttp.ts'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { StyldDatabase, StyldMedia } from './Resources.ts'

const Runtime = Layer.mergeAll(DomainLive, Cloudflare.Telemetry({ headSamplingRate: 1 }))

export class StyldWorker extends Cloudflare.Worker<StyldWorker, Cloudflare.WorkerShape>()('StyldWorker') {}

export default StyldWorker.make(
  {
    main: import.meta.url,
    // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
    compatibility: { date: '2026-10-19' },
    observability: { enabled: true, logs: { enabled: true, invocationLogs: true } },
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
    const env = yield* Cloudflare.Workers.WorkerEnvironment
    const authOrigin: unknown = env.AUTH_ORIGIN
    if (typeof authOrigin !== 'string' || authOrigin.length === 0) {
      return yield* Effect.die(new Error('AUTH_ORIGIN binding is required'))
    }
    const authSessionKeys = yield* decodeAuthSessionKeyring(env.AUTH_SESSION_KEYS).pipe(Effect.orDie)
    const authSecret = yield* decodeAuthSecret(env.AUTH_SECRET).pipe(Effect.orDie)

    const auth = makeAuthHttp(database, {
      origin: authOrigin,
      secret: authSecret,
      secureCookies: true,
      sessionKeys: authSessionKeys,
    })
    const storage = Effect.gen(function* () {
      const tables = yield* database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all<{ name: string }>()
      const mediaHealth = yield* media.head('health/sentinel').pipe(Effect.orDie)
      return yield* HttpServerResponse.json({
        database: {
          tables: tables.results
            .map((row) => row.name)
            .filter((name) => !name.startsWith('__') && !name.startsWith('_cf_')),
        },
        media: { sentinel: mediaHealth !== null },
      })
    })
    const routes = Layer.mergeAll(
      auth.layer,
      HttpRouter.add('GET', '/api/health', health()),
      HttpRouter.add('GET', '/api/storage', storage),
    )
    const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)

    return {
      fetch: handle,
    }
  }).pipe(Effect.provide(Runtime)),
)
