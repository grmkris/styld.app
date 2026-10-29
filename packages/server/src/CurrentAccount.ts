import { Context } from 'effect'

/** Whose data an operation acts on, decided by the transport: the website's session or an
 * assistant's OAuth grant. Operations never take an account id from their input. Like a request, it is
 * provided per call, so services name it in their methods on purpose.
 * @effect-leakable-service */
export class CurrentAccount extends Context.Service<
  CurrentAccount,
  { readonly accountId: string; readonly via: 'session' | 'assistant' }
>()('@styld/server/CurrentAccount') {}
