import { Context } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api'
import { NotFound } from './Errors.ts'

// The operator: whoever holds the stage's operator token (owner, 4 November 2026). Administrative tasks that no page
// offers, such as importing a v1 wardrobe, are the operator's, from the operator's own tools: a bearer token from the
// stage's private env file, not a browser session, so no cookie is ever copied out of a browser and no CSRF applies (a
// browser never sends an Authorization header on its own). The operator is not an account.

/** The operator, once their token is checked. */
export class CurrentOperator extends Context.Service<CurrentOperator, { readonly via: 'token' }>()(
  '@styld/protocol/CurrentOperator',
) {}

/** Admits the operator by the stage's operator token. A wrong or missing token, or a stage with no token, answers as
 * if the route were not there. */
export class OperatorAuth extends HttpApiMiddleware.Service<OperatorAuth, { provides: CurrentOperator }>()(
  '@styld/protocol/OperatorAuth',
  { security: { bearer: HttpApiSecurity.bearer }, error: NotFound },
) {}
