import { CurrentAccount, StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { AccountLifecycle } from './AccountLifecycle.ts'
import { withAuth } from './AuthHttp.ts'
import { module } from './kernel/Module.ts'

const accountHandlers = HttpApiBuilder.group(StyldApi, 'account', (handlers) =>
  Effect.gen(function* () {
    const lifecycle = yield* AccountLifecycle
    return handlers.handle(
      'deleteMe',
      Effect.fn('Styld.Api.account.deleteMe')(function* () {
        const { accountId } = yield* CurrentAccount
        yield* lifecycle.deleteAccount(accountId)
      }),
    )
  }),
)

/** The account: signing in (Yielded's auth routes), reading it and deleting it with everything it owns; the sweep
 * finishes every deletion the queue did not. */
export const account = module({
  layer: AccountLifecycle.layer,
  api: accountHandlers,
  routes: withAuth((auth) => auth.layer),
  sweeps: [
    {
      name: 'accountDeletions',
      run: Effect.flatMap(AccountLifecycle, (lifecycle) => lifecycle.sweepDeletions()),
    },
  ],
})
