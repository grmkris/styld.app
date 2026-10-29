import { SessionHttp } from '@styld/auth/config'
import { StyldApi } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { makeAuthHttp } from './AuthHttp.ts'
import { WardrobeHandlers } from './wardrobe/Http.ts'
import type { Wardrobe } from './wardrobe/Wardrobe.ts'

const AccountHandlers = HttpApiBuilder.group(StyldApi, 'account', (handlers) =>
  handlers.handle(
    'me',
    Effect.fn('Styld.Api.account.me')(function* () {
      const { claims } = yield* SessionHttp.CurrentSession
      return { accountId: claims.accountId, displayName: claims.displayName, email: claims.email }
    }),
  ),
)

/** The typed API's routes. Yielded's request middleware validates every request and its session
 * security implements `SessionHttp.RequireSession`. */
export const apiRoutes = (auth: ReturnType<typeof makeAuthHttp>, wardrobe: Layer.Layer<Wardrobe>) =>
  HttpApiBuilder.layer(StyldApi).pipe(
    Layer.provide(AccountHandlers),
    Layer.provide(WardrobeHandlers.pipe(Layer.provide(wardrobe))),
    Layer.provide(auth.router.securityLayer(SessionHttp)),
    auth.router.middleware,
    Layer.provide(auth.dependencies),
  )
