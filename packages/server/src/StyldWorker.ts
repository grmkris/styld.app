import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'

const Runtime = Layer.mergeAll(DomainLive, Cloudflare.Telemetry({ headSamplingRate: 1 }))

export default class StyldWorker extends Cloudflare.Worker<StyldWorker>()(
  'StyldWorker',
  {
    main: import.meta.url,
    // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
    compatibility: { date: '2026-10-19' },
    observability: { enabled: true, logs: { enabled: true, invocationLogs: true } },
  },
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest
      const path = new URL(request.url, 'https://styld.invalid').pathname
      if (request.method === 'GET' && path === '/api/health') return yield* health()
      return HttpServerResponse.empty({ status: 404 })
    }),
  }).pipe(Effect.provide(Runtime)),
) {}
