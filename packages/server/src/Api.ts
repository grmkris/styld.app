import { SessionHttp } from '@styld/auth/config'
import { StyldApi } from '@styld/protocol'
import { Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { AuthHttp } from './AuthHttp.ts'
import { sessionAccountLayer, yieldedAdmission } from './SessionAccount.ts'

/** The typed API's routes over every module's group handlers. Yielded's request middleware validates every request,
 * its session security implements `SessionHttp.RequireSession`, and `SessionAccount` makes the session the operations'
 * `CurrentAccount`. */
export const apiRoutes = <Groups, E, R>(auth: AuthHttp, groups: Layer.Layer<Groups, E, R>) =>
  HttpApiBuilder.layer(StyldApi).pipe(
    Layer.provide(groups),
    Layer.provide(sessionAccountLayer(yieldedAdmission(auth))),
    Layer.provide(auth.router.securityLayer(SessionHttp)),
    auth.router.middleware,
    Layer.provide(auth.dependencies),
  )
