import { Subscription, Update } from 'foldkit'
import type { Model } from './App.ts'
import { at, data, onTab } from './AppLens.ts'
import type { Message } from './Message.ts'
import * as NavigationState from './NavigationState.ts'
import { lenses } from './Page.ts'
import * as TryOn from './page/TryOn.ts'
import { AppRoute, tryOnPageRouter, tryOnRouter } from './route.ts'
import * as ServerData from './ServerData.ts'
import type { StyldClient } from './StyldClient.ts'
import type * as SecureRandom from 'effect/crypto/SecureRandom'

// Try on's tab and a try-on's own page run the same program (`page/TryOn.ts`); the app folds both the same way.

type Step = Update.Step<Model, Message, StyldClient | SecureRandom.SecureRandom>

/** A try-on started opens its own page, the open one deleted goes back to the list, and Save to board's sheet asks
 * for the boards again. */
const foldOut = TryOn.OutMessage.match<Step>({
  RequestedBoards: () => Update.foldChildStep({ update: ServerData.revisitBoards, ...data }),
  StartedTryOn: ({ tryOnId }) => NavigationState.navigateTo(tryOnPageRouter({ tryOnId })),
  DeletedTryOn: () => NavigationState.navigateTo(tryOnRouter({})),
})

/** The tab's and the page's folds, under their `foldPages` names. */
export const foldTryOn = {
  tryOn: Update.foldChild({ update: TryOn.update, ...at(lenses.tryOn), foldOutMessage: foldOut }),
  tryOnPage: Update.foldChild({ update: TryOn.update, ...at(lenses.tryOnPage), foldOutMessage: foldOut }),
}

/** Each follows its try-ons being drawn while it is open: the tab while its route shows, the page while it is open. */
export const tryOnSubscriptions = Subscription.aggregate(
  Subscription.lift(TryOn.subscriptions)<Model, Message>(onTab(lenses.tryOn, AppRoute.guards.TryOn)),
  Subscription.lift(TryOn.pageSubscriptions)<Model, Message>(at(lenses.tryOnPage)),
)
