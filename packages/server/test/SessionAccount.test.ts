import { describe, expect, it } from '@effect/vitest'
import { SessionHttp } from '@styld/auth/config'
import { CurrentAccount, RequestRefused, SessionAccount, sessionAccountClient } from '@styld/protocol'
import { type Context, Effect, Layer, Schema } from 'effect'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiTest } from 'effect/http-api'
import { HttpServer } from 'effect/http'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { type AdmitChange, sessionAccountLayer } from '../src/SessionAccount.ts'

// The session middleware through a typed API in memory: the session's account reaches the operation as
// `CurrentAccount`, a read runs as it is, and a change runs only once admitted. Yielded's own session check and
// admission (Origin and CSRF header on real requests) are exercised by the native suite; here the session is given
// and a change is admitted when it carries the header the client half sends.

const session = Schema.decodeUnknownSync(SessionHttp.session)({
  sessionId: 'se_1',
  subjectId: 'ac_session',
  securityRevision: 'r1',
  assurance: { method: 'password', factors: ['knowledge'], authenticatedAt: 0 },
  issuedAt: 0,
  expiresAt: 0,
  absoluteExpiresAt: 0,
  claims: { accountId: 'ac_session', displayName: 'Ana', email: 'ana@example.com', emailVerified: true },
})

/** Yielded's session check, already passed. */
class GivenSession extends HttpApiMiddleware.Service<
  GivenSession,
  { provides: Context.Service.Identifier<typeof SessionHttp.CurrentSession> }
>()('test/GivenSession') {}

/** A group declared like the API's: `SessionAccount` before the session check. */
class Probe extends HttpApiGroup.make('probe')
  .add(HttpApiEndpoint.get('read', '/read', { success: Schema.String }))
  .add(HttpApiEndpoint.post('change', '/change', { success: Schema.String }))
  .middleware(SessionAccount)
  .middleware(GivenSession) {}

class ProbeApi extends HttpApi.make('probe').add(Probe) {}

/** Who an operation acts for, as it sees it. */
const actingFor = Effect.map(CurrentAccount, ({ accountId, via }) => `${accountId}/${via}`)

/** Admitted when the request carries the website's CSRF header. */
const byHeader: AdmitChange = (effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.headers['x-effect-auth-csrf'] !== '1') return yield* RequestRefused.make({})
    return yield* effect
  })

const server = HttpApiBuilder.group(ProbeApi, 'probe', (handlers) =>
  Effect.succeed(handlers.handle('read', () => actingFor).handle('change', () => actingFor)),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      sessionAccountLayer(byHeader),
      Layer.succeed(
        GivenSession,
        GivenSession.of((httpEffect) => Effect.provideService(httpEffect, SessionHttp.CurrentSession, session)),
      ),
    ),
  ),
  Layer.merge(HttpServer.layerServices),
)

/** A client without the header, like a cross-site form. */
const bareClient = HttpApiMiddleware.layerClient(SessionAccount, ({ next, request }) => next(request))

describe('the session middleware', () => {
  it.effect('acts for the session account, and admits a change sent by the client half', () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(ProbeApi, ['probe'])
      expect(yield* client.probe.read()).toBe('ac_session/session')
      expect(yield* client.probe.change()).toBe('ac_session/session')
    }).pipe(Effect.provide(Layer.merge(server, sessionAccountClient)), Effect.scoped),
  )

  it.effect('reads without admission, and refuses a change that was not admitted', () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(ProbeApi, ['probe'])
      expect(yield* client.probe.read()).toBe('ac_session/session')
      const refused = yield* client.probe.change().pipe(Effect.flip)
      expect(refused).toBeInstanceOf(RequestRefused)
    }).pipe(Effect.provide(Layer.merge(server, bareClient)), Effect.scoped),
  )
})
