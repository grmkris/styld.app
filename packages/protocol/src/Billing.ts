import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { NotFound, Unavailable } from './Errors.ts'
import { OperatorAuth } from './Operator.ts'
import { OperationId } from './Ids.ts'
import { planNames } from './Prices.ts'
import { SessionAccount } from './Session.ts'

// Plans (owner, 4 November 2026): a new account has 3 free credits once; a week, a month, a year or a lifetime,
// bought through Dodo Payments as merchant of record, gives the members' daily allowance while it lasts.

/** One of the plans `Prices.ts` lists. */
export const Plan = Schema.Literals(planNames)

/** The account's plan while it is active: until when (an ISO instant; none for lifetime) and whether it renews. */
export const Membership = Schema.Struct({
  plan: Plan,
  until: Schema.NullOr(Schema.String),
  renews: Schema.Boolean,
})
export type Membership = typeof Membership.Type

/** The signed-in person's credits: what is left now (today's and the free ones), today's allowance (0 without a plan),
 * the free credits left, the active plan, whether this deployment sells plans at all, and whether Dodo's customer
 * portal has the person's payments to manage. */
export const CreditBalance = Schema.Struct({
  remaining: Schema.Int,
  daily: Schema.Int,
  free: Schema.Int,
  membership: Schema.NullOr(Membership),
  plansAvailable: Schema.Boolean,
  manageable: Schema.Boolean,
})
export type CreditBalance = typeof CreditBalance.Type

/** A plan's checkout to open. */
export const ChoosePlan = Schema.Struct({ operationId: OperationId, plan: Plan })
export type ChoosePlan = typeof ChoosePlan.Type

/** Where the browser goes: Dodo's hosted checkout, or its customer portal. */
export const Checkout = Schema.Struct({ url: Schema.String })
export type Checkout = typeof Checkout.Type

/** The person's credits, a plan's checkout and the customer portal. A deployment without payments answers `NotFound`
 * to the checkout, and so does the portal for an account Dodo knows nothing of. */
export class BillingApi extends HttpApiGroup.make('billing')
  .add(HttpApiEndpoint.get('credits', '/credits', { success: CreditBalance, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('checkout', '/billing/checkout', {
      payload: ChoosePlan,
      success: Checkout,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('portal', '/billing/portal', {
      payload: Schema.Struct({ operationId: OperationId }),
      success: Checkout,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}

/** Whose membership the operator grants: the account the email signs in to. A lifetime membership, for the owner,
 * testers, the house accounts and v1's hand-granted members; granting again changes nothing. */
export const MembershipGrant = Schema.Struct({
  operationId: OperationId,
  email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320)),
})
export type MembershipGrant = typeof MembershipGrant.Type

export const MembershipGranted = Schema.Struct({ accountId: Schema.String })
export type MembershipGranted = typeof MembershipGranted.Type

/** The operator's grant of a lifetime membership. Only the operator, by the stage's operator token (`Operator.ts`), may
 * ask; to anyone else it is not there. */
export class MembershipGrantApi extends HttpApiGroup.make('membershipGrant')
  .add(
    HttpApiEndpoint.post('grantMembership', '/operator/memberships', {
      payload: MembershipGrant,
      success: MembershipGranted,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(OperatorAuth) {}
