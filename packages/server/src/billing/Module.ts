import { Layer } from 'effect'
import { account } from '../Account.ts'
import { module } from '../kernel/Module.ts'
import { Billing } from './Billing.ts'
import { billingHandlers, billingRoutes } from './Http.ts'

/** Styld Premium Week through Dodo Payments: the person's credits, the checkout, and the webhook that credits a
 * payment. */
export const billing = module({
  layer: Billing.layer.pipe(Layer.provide(account.layer)),
  api: billingHandlers,
  routes: billingRoutes,
})
