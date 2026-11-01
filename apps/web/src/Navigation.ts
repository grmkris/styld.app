import { Effect, Option, Schema } from 'effect'
import { Command, Dom, Render } from 'foldkit'
import { load, pushUrl, UrlRequest } from 'foldkit/navigation'
import { type Url, toString as urlToString } from 'foldkit/url'
import { Message } from './Message.ts'
import { accountRouter, AppRoute, isSameTab, returnPath, routeFromUrl, tabOf } from './route.ts'
import { noteReturn } from './SignInReturn.ts'

// How the website moves between pages, after Foldkit's own website (repos/foldkit/packages/website/src/main.ts):
// tab pages switch inside the page, keeping the navigation and what the app already has; every other page loads
// whole and renders on the server.

// COMMAND

/** A full page load: the next page renders on the server for the new session. */
export const Navigate = Command.define('Navigate', {
  args: { href: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedNavigate())),
})

/** Follow pressed signed out: sign-in, with the profile it returns to noted for this tab, so only that arrival follows.
 */
export const SignInToFollow = Command.define('SignInToFollow', {
  args: { href: Schema.String, returnTo: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ href, returnTo }) =>
    noteReturn(returnTo).pipe(Effect.andThen(load(href)), Effect.as(Message.CompletedNavigate())),
})

/** Where sign-in hands over to: the page it was asked from (a Follow or a Save on a public page), else the account. */
export const returnAfterSignIn = (next: Option.Option<string>) =>
  Navigate({ href: Option.getOrElse(returnPath(next), () => accountRouter({})) })

/** Another tab page in the same document: the address changes and `ChangedUrl` opens it.
 */
export const NavigateInternal = Command.define('NavigateInternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ href }) => pushUrl(href).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

/** To the top of the new page, once it is drawn, so it wins over the browser's own restore on Back.
 */
export const ScrollToTop = Command.define('ScrollToTop', {
  messages: [Message.CompletedScrollToTop],
  execute: Effect.gen(function* () {
    yield* Render.afterCommit
    window.scrollTo({ top: 0, behavior: 'instant' })
    return Message.CompletedScrollToTop()
  }),
})

/** To a section of the page, which then takes focus.
 */
export const ScrollToAnchor = Command.define('ScrollToAnchor', {
  args: { hash: Schema.String },
  messages: [Message.CompletedScrollToAnchor],
  execute: ({ hash }) =>
    Effect.gen(function* () {
      const target = `#${CSS.escape(hash)}`
      yield* Dom.scrollIntoViewAfterPaint(target, { block: 'start' })
      yield* Dom.focus(target, { preventScroll: true, makeFocusable: true })
    }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollToAnchor())),
})

/** The new page's title takes focus, so a screen reader starts there.
 */
export const FocusPageTitle = Command.define('FocusPageTitle', {
  messages: [Message.CompletedFocusPageTitle],
  execute: Dom.focus('#main h1', { preventScroll: true, makeFocusable: true }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusPageTitle()),
  ),
})

/** Every followed link and every change of address becomes a Message (`Runtime.makeApplication`'s `routing`). */
export const routing = {
  onUrlRequest: (request: UrlRequest) => Message.ClickedLink({ request }),
  onUrlChange: (url: Url) => Message.ChangedUrl({ url }),
}

// UPDATE

/** A return that finishes a Follow (`#follow`, People › FollowArrival). */
const followsOnReturn = (path: string) => path.endsWith('#follow')

/** A followed link. Between tab pages, for someone signed in, the page stays and only the address changes; the
 * current tab scrolls back to its top; a section of the same page is scrolled to; everything else loads whole, and
 * a Follow pressed signed out notes where sign-in returns first. */
export const followLink = (route: AppRoute, isSignedIn: boolean, request: UrlRequest) =>
  UrlRequest.match(request, {
    Internal: ({ url }) => {
      const target = routeFromUrl(url)
      const href = urlToString(url)
      const toFollow = AppRoute.guards.Login(target)
        ? Option.filter(returnPath(target.next), followsOnReturn)
        : Option.none()
      if (Option.isSome(toFollow)) return [SignInToFollow({ href, returnTo: toFollow.value })]
      const bothTabs = Option.isSome(tabOf(route)) && Option.isSome(tabOf(target))
      if (bothTabs && isSameTab(route, target))
        return Option.isSome(url.hash) ? [NavigateInternal({ href })] : [ScrollToTop()]
      return bothTabs && isSignedIn ? [NavigateInternal({ href })] : [Navigate({ href })]
    },
    External: ({ href }) => [Navigate({ href })],
  })

/** Arriving on a page opened inside the document: at a section when the address names one, else at the top with
 * the title focused. */
export const arrive = (hash: Option.Option<string>) =>
  Option.match(hash, {
    onNone: () => [ScrollToTop(), FocusPageTitle()],
    onSome: (section) => [ScrollToAnchor({ hash: section })],
  })

/** Tab changes cross-fade (DESIGN.md › Motion); anything else, such as a search typed into the address, does not. */
export const isTabChange = (previous: AppRoute, next: AppRoute) => !isSameTab(previous, next)
