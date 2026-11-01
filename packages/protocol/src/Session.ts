import { csrf, SessionHttp } from '@styld/auth/config'
import { Context } from 'effect'
import { HttpApiMiddleware } from 'effect/http-api'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { RequestRefused } from './Errors.ts'

/** Whose data an operation acts on, decided by the transport: the website's session (`SessionAccount`) or an
 * assistant's OAuth grant. Operations never take an account id from their input. Like a request, it is provided per
 * call, so services name it in their methods on purpose.
 * @effect-leakable-service */
export class CurrentAccount extends Context.Service<
  CurrentAccount,
  { readonly accountId: string; readonly via: 'session' | 'assistant' }
>()('@styld/protocol/CurrentAccount') {}

/** The website's session, handled once for every group that needs one: the session's account as `CurrentAccount`,
 * and a change (anything but `GET`) admitted only from the website itself, its Origin and CSRF header, before it
 * runs. A group declares it before `SessionHttp.RequireSession`, which checks the session it reads. */
export class SessionAccount extends HttpApiMiddleware.Service<
  SessionAccount,
  {
    provides: CurrentAccount
    requires: Context.Service.Identifier<typeof SessionHttp.CurrentSession>
  }
>()('@styld/protocol/SessionAccount', { error: RequestRefused, requiredForClient: true }) {}

/** The client half: every request the typed client sends carries the website's CSRF header. */
export const sessionAccountClient = HttpApiMiddleware.layerClient(SessionAccount, ({ next, request }) =>
  next(HttpClientRequest.setHeader(request, csrf.header, csrf.value)),
)
