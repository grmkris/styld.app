import { Option } from 'effect'
import { AsyncData, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { Model } from './App.ts'
import type { Message } from './Message.ts'
import { Navigate, ReplaceInternal, ReturnToParent, ScrollToAnchor } from './Navigation.ts'
import { Page } from './Page.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import { AppRoute, boardRouter, parentReturn, wardrobeRouter } from './route.ts'

type NavigationUpdate = Update.Return<Model, Message>

/** What the wardrobe page is given with each Message: the browse its address shows, while it shows. */
export const wardrobeContext = (route: AppRoute): Wardrobe.Context => ({
  maybeBrowse: AppRoute.guards.Wardrobe(route) ? Option.some(route.browse) : Option.none(),
})

export const navigateTo =
  (href: string) =>
  (model: Model): NavigationUpdate => ({ model, commands: [Navigate({ href })] })

/** An address replaced on the page it was already on (a board's collage address, Styld's once its question is in the
 * draft): the route follows in place, with no new page load. */
export const samePageArrival = (model: Model, route: AppRoute): Option.Option<NavigationUpdate> => {
  if (AppRoute.guards.Stylist(model.route) && AppRoute.guards.Stylist(route))
    return Option.some({ model: modifyFields(model, { route: () => route }) })
  if (AppRoute.guards.Board(model.route) || AppRoute.guards.BoardCollage(model.route)) {
    if (AppRoute.guards.BoardCollage(route) && route.boardId === model.route.boardId)
      return Option.some({ model, commands: [ReplaceInternal({ href: boardRouter({ boardId: route.boardId }) })] })
    if (AppRoute.guards.Board(route) && route.boardId === model.route.boardId)
      return Option.some({ model: modifyFields(model, { route: () => route }) })
  }
  return Option.none()
}

export const restoreBrowsing = (model: Model, route: AppRoute, hash: Option.Option<string>): Model =>
  modifyFields(model, {
    route: () => route,
    maybeWardrobeAnchor: () =>
      AppRoute.guards.Wardrobe(route) && Option.isNone(AsyncData.getData(model.data.pieces)) ? hash : Option.none(),
    page: (page) =>
      AppRoute.guards.Wardrobe(route) && Page.guards.Tabs(page)
        ? modifyFields(page, {
            tabs: (tabs) =>
              modifyFields(tabs, {
                wardrobe: Wardrobe.reflectBrowse(wardrobeContext(model.route).maybeBrowse, route.browse),
              }),
          })
        : page,
  })

export const restoreWardrobePosition = (model: Model): NavigationUpdate =>
  AppRoute.guards.Wardrobe(model.route) && Option.isSome(model.maybeWardrobeAnchor)
    ? {
        model: modifyFields(model, { maybeWardrobeAnchor: () => Option.none() }),
        commands: [ScrollToAnchor({ hash: model.maybeWardrobeAnchor.value })],
      }
    : { model }

export const returnFromPiece = (model: Model): NavigationUpdate => {
  const parent = AppRoute.guards.Piece(model.route) ? parentReturn(model.route.from, 'Wardrobe') : Option.none()
  return {
    model,
    commands: [
      Option.match(parent, {
        onNone: () => Navigate({ href: wardrobeRouter({}) }),
        onSome: (href) => ReturnToParent({ href }),
      }),
    ],
  }
}

export const returnFromReview = (model: Model): NavigationUpdate => ({
  model,
  commands: [
    Navigate({
      href: AppRoute.guards.Review(model.route)
        ? Option.getOrElse(parentReturn(model.route.from, 'Photo'), () => wardrobeRouter({}))
        : wardrobeRouter({}),
    }),
  ],
})
