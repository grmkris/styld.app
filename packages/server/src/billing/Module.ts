import { Layer } from 'effect'
import { account } from '../Account.ts'
import { module } from '../kernel/Module.ts'
import { Billing } from './Billing.ts'
import { billingHandlers, billingRoutes, membershipGrantHandlers } from './Http.ts'

/** Plans through Dodo Payments: the person's credits, a plan's checkout, the customer portal, the webhook that gives
 * or moves a membership, and the operator's grant. */
export const billing = module({
  layer: Billing.layer.pipe(Layer.provide(account.layer)),
  api: Layer.mergeAll(billingHandlers, membershipGrantHandlers),
  routes: billingRoutes,
})
