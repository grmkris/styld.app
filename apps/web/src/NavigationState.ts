import { Option } from 'effect'
import { AsyncData, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { Model } from './App.ts'
import type { Message } from './Message.ts'
import { Navigate, ReplaceInternal, ReturnToParent, ScrollToAnchor } from './Navigation.ts'
import { Page } from './Page.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import { AppRoute, boardRouter, parentReturn, wardrobeRouter } from './route.ts'
import type { BrowseQuery } from './WardrobeBrowse.ts'

type NavigationUpdate = Update.Return<Model, Message>

/** The wardrobe's browsing in place of the current address, then what follows it: reading the pieces again once a
 * category it showed was renamed or deleted (T-12). */
export const browsedTo = <R>(query: BrowseQuery, after: ReadonlyArray<Update.Step<Model, Message, R>>) =>
  Update.combine<Model, Message, R>([
    (model) => ({ model, commands: [ReplaceInternal({ href: wardrobeRouter(query) })] }),
    ...after,
  ])

export const navigateTo =
  (href: string) =>
  (model: Model): NavigationUpdate => ({ model, commands: [Navigate({ href })] })

export const sameBoardArrival = (model: Model, route: AppRoute): Option.Option<NavigationUpdate> => {
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
            tabs: (tabs) => modifyFields(tabs, { wardrobe: (wardrobe) => Wardrobe.restore(wardrobe, route) }),
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
