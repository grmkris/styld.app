import { Effect } from 'effect'

// Where sign-in returned this tab to. A Follow pressed signed out comes back at `#follow`, and only the arrival sign-in
// made follows: a link that merely ends in `#follow`, a reload or a Back to the page does not.

const key = 'styld.signInReturn'

/** Notes for this tab the page sign-in returns to; without storage the page opens all the same, unfollowed. */
export const noteReturn = (href: string) =>
  Effect.try(() => window.sessionStorage.setItem(key, href)).pipe(Effect.ignore)

/** Whether sign-in returned this tab to the address it is at now. The note is spent, and a `#follow` leaves the address,
 * so a reload or Back does not follow again; the address is replaced quietly, as the page itself has not changed. */
export const tookReturn = Effect.try(() => {
  const noted = window.sessionStorage.getItem(key)
  window.sessionStorage.removeItem(key)
  const here = window.location.href
  if (window.location.hash === '#follow')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
  return noted !== null && new URL(noted, window.location.origin).href === here
}).pipe(Effect.orElseSucceed(() => false))
