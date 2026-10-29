import { SessionHttp } from '@styld/auth/config'
import { StyldApi } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { AccountLifecycle } from './AccountLifecycle.ts'
import type { makeAuthHttp } from './AuthHttp.ts'
import { captureHandlers } from './capture/Http.ts'
import type { Captures } from './capture/Service.ts'
import { lookHandlers } from './looks/Http.ts'
import type { Looks } from './looks/Looks.ts'
import { type Admit, admitWith, wardrobeHandlers } from './wardrobe/Http.ts'
import type { Wardrobe } from './wardrobe/Wardrobe.ts'

const accountHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'account', (handlers) =>
    Effect.gen(function* () {
      const lifecycle = yield* AccountLifecycle
      return handlers
        .handle(
          'me',
          Effect.fn('Styld.Api.account.me')(function* () {
            const { claims } = yield* SessionHttp.CurrentSession
            return { accountId: claims.accountId, displayName: claims.displayName, email: claims.email }
          }),
        )
        .handle(
          'deleteMe',
          Effect.fn('Styld.Api.account.deleteMe')(function* () {
            const { claims } = yield* SessionHttp.CurrentSession
            yield* admit(lifecycle.deleteAccount(claims.accountId))
          }),
        )
    }),
  )

/** The typed API's routes. Yielded's request middleware validates every request and its session
 * security implements `SessionHttp.RequireSession`. */
export const apiRoutes = (
  auth: ReturnType<typeof makeAuthHttp>,
  services: {
    readonly wardrobe: Layer.Layer<Wardrobe>
    readonly lifecycle: Layer.Layer<AccountLifecycle>
    readonly captures: Layer.Layer<Captures>
    readonly looks: Layer.Layer<Looks>
  },
) =>
  HttpApiBuilder.layer(StyldApi).pipe(
    Layer.provide(accountHandlers(admitWith(auth)).pipe(Layer.provide(services.lifecycle))),
    Layer.provide(wardrobeHandlers(admitWith(auth)).pipe(Layer.provide(services.wardrobe))),
    Layer.provide(captureHandlers(admitWith(auth)).pipe(Layer.provide(services.captures))),
    Layer.provide(lookHandlers(admitWith(auth)).pipe(Layer.provide(services.looks))),
    Layer.provide(auth.router.securityLayer(SessionHttp)),
    auth.router.middleware,
    Layer.provide(auth.dependencies),
  )
