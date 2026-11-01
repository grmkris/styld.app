import { SessionHttp } from '@styld/auth/config'
import { CurrentAccount, RequestRefused, SessionAccount } from '@styld/protocol'
import { AuthRequest } from '@yielded/auth/Auth'
import { Effect, Layer, Option } from 'effect'
import type * as HttpServerRequest from 'effect/http/HttpServerRequest'
import type { AuthHttp } from './AuthHttp.ts'

/** Runs a change only once it is admitted, else `RequestRefused`. */
export type AdmitChange = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | RequestRefused, R | HttpServerRequest.HttpServerRequest>

/** Yielded's admission of a change from the website itself: its Origin and CSRF header. */
export const yieldedAdmission =
  (auth: AuthHttp): AdmitChange =>
  (effect) =>
    Effect.gen(function* () {
      // Yielded's request middleware wraps every API route, so its request is always there.
      const request = yield* Effect.serviceOption(AuthRequest)
      if (Option.isNone(request)) return yield* Effect.die(new Error('the API runs outside the auth middleware'))
      return yield* auth.router.protect(effect).pipe(
        Effect.provideService(AuthRequest, request.value),
        Effect.catchTag('HookDenied', () => Effect.fail(RequestRefused.make({}))),
      )
    })

/** `SessionAccount` on the server: the session `RequireSession` checked becomes `CurrentAccount`, and anything but a
 * `GET` runs only once admitted. */
export const sessionAccountLayer = (admit: AdmitChange) =>
  Layer.succeed(
    SessionAccount,
    SessionAccount.of(
      Effect.fnUntraced(function* (httpEffect, { endpoint }) {
        const { claims } = yield* SessionHttp.CurrentSession
        const handled = Effect.provideService(httpEffect, CurrentAccount, {
          accountId: claims.accountId,
          via: 'session',
        })
        return yield* endpoint.method === 'GET' ? handled : admit(handled)
      }),
    ),
  )
