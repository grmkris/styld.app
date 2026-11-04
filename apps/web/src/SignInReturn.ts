import { Effect } from 'effect'

// A Follow pressed signed out goes through sign-in and comes back at `#follow`. The press notes the return for this tab,
// and only an arrival this tab asked for follows: a link that merely ends in `#follow`, a sign-in link sent by someone
// else, a reload or a Back to the page does not.

const key = 'styld.signInReturn'

/** Notes for this tab, as Follow is pressed signed out, the page sign-in is to return to; without storage the page
 * opens all the same, unfollowed. */
export const noteReturn = (href: string) =>
  Effect.try(() => window.sessionStorage.setItem(key, href)).pipe(Effect.ignore)

/** Whether this tab pressed Follow signed out for the address it is at now. The note is spent, and `#follow` leaves the
 * address, so a reload or Back does not follow again; the address is replaced quietly, as the page has not changed. */
export const tookReturn = Effect.try(() => {
  const noted = window.sessionStorage.getItem(key)
  window.sessionStorage.removeItem(key)
  const here = window.location.href
  if (window.location.hash === '#follow')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
  return noted !== null && new URL(noted, window.location.origin).href === here
}).pipe(Effect.orElseSucceed(() => false))

const nextKey = 'styld.signInNext'

/** Notes for this tab where sign-in was to return to (`/login?next=…`), as the page leaves for Google, whose return
 * address cannot carry it; none clears an older note. */
export const noteNext = (next: string | null) =>
  Effect.try(() =>
    next === null ? window.sessionStorage.removeItem(nextKey) : window.sessionStorage.setItem(nextKey, next),
  ).pipe(Effect.ignore)

/** The return this tab noted before Google, spent as it is read. */
export const tookNext = Effect.try(() => {
  const noted = window.sessionStorage.getItem(nextKey)
  window.sessionStorage.removeItem(nextKey)
  return noted
}).pipe(Effect.orElseSucceed(() => null))
