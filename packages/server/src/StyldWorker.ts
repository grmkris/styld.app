import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { StyldDatabase, StyldMedia } from './Resources.ts'

const Runtime = Layer.mergeAll(DomainLive, Cloudflare.Telemetry({ headSamplingRate: 1 }))

export default class StyldWorker extends Cloudflare.Worker<StyldWorker>()(
  'StyldWorker',
  {
    main: import.meta.url,
    // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
    compatibility: { date: '2026-10-19' },
    observability: { enabled: true, logs: { enabled: true, invocationLogs: true } },
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const path = new URL(request.url, 'https://styld.invalid').pathname
        if (request.method === 'GET' && path === '/api/health') return yield* health()
        if (request.method === 'GET' && path === '/api/storage') {
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
        }
        return HttpServerResponse.empty({ status: 404 })
      }),
    }
  }).pipe(Effect.provide(Runtime)),
) {}
