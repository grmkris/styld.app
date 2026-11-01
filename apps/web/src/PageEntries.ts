import { Match, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { Model, Services } from './App.ts'
import { Message } from './Message.ts'
import { Navigate } from './Navigation.ts'
import * as Account from './page/Account.ts'
import * as Ask from './page/Ask.ts'
import * as Boards from './page/Boards.ts'
import * as Look from './page/Look.ts'
import * as Looks from './page/Looks.ts'
import * as Photo from './page/Photo.ts'
import * as Photos from './page/Photos.ts'
import * as Today from './page/Today.ts'
import * as Visit from './page/Visit.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import { type AppRoute, boardRouter, looksRouter, photosRouter } from './route.ts'

// What opening each tab page asks for, on a first load and on every tab change (App.ts `init` and `changedUrl`):
// each page's own entry, folded into the app.

export type Step = Update.Step<Model, Message, Services>

const foldWardrobe = (update: typeof Wardrobe.enter) =>
  Update.foldChildStep({
    update,
    read: (model: Model) => Option.some(model.wardrobe),
    write: (model: Model, wardrobe: Wardrobe.Model) => modifyFields(model, { wardrobe: () => wardrobe }),
    toParentMessage: (message: Wardrobe.Message) => Message.GotWardrobeMessage({ message }),
  })

/** Opening a page that shows the pieces: the ones already here stay while they are asked for again. */
export const foldWardrobeRevisit = foldWardrobe(Wardrobe.revisit)
/** Opening the wardrobe itself: its pieces, and how many have no clean picture yet. */
const foldWardrobeEnter = foldWardrobe(Wardrobe.enter)

const foldLooksRevisit = Update.foldChildStep({
  update: Looks.revisit,
  read: (model: Model) => Option.some(model.looks),
  write: (model: Model, looks: Looks.Model) => modifyFields(model, { looks: () => looks }),
  toParentMessage: (message: Looks.Message) => Message.GotLooksMessage({ message }),
})

const foldPhotosRevisit = Update.foldChildStep({
  update: Photos.revisit,
  read: (model: Model) => Option.some(model.photos),
  write: (model: Model, photos: Photos.Model) => modifyFields(model, { photos: () => photos }),
  toParentMessage: (message: Photos.Message) => Message.GotPhotosMessage({ message }),
})

/** My Gallery inside the app. */
export const foldPhotos = Update.foldChild({
  update: Photos.update,
  read: (model: Model) => Option.some(model.photos),
  write: (model: Model, photos: Photos.Model) => modifyFields(model, { photos: () => photos }),
  toParentMessage: (message: Photos.Message) => Message.GotPhotosMessage({ message }),
})

/** The looks inside the app. */
export const foldLooks = Update.foldChild({
  update: Looks.update,
  read: (model: Model) => Option.some(model.looks),
  write: (model: Model, looks: Looks.Model) => modifyFields(model, { looks: () => looks }),
  toParentMessage: (message: Looks.Message) => Message.GotLooksMessage({ message }),
})

/** A look's page: deleting it goes back to the looks. */
export const foldLook = Update.foldChild({
  update: Look.update,
  read: (model: Model) => Option.some(model.look),
  write: (model: Model, look: Look.Model) => modifyFields(model, { look: () => look }),
  toParentMessage: (message: Look.Message) => Message.GotLookMessage({ message }),
  foldOutMessage: Look.OutMessage.match<Update.Step<Model, Message, Services>>({
    DeletedLook: () => (stepModel) => ({ model: stepModel, commands: [Navigate({ href: looksRouter({}) })] }),
  }),
})

/** One photo of My Gallery: deleting it goes back to the Gallery. */
export const foldPhoto = Update.foldChild({
  update: Photo.update,
  read: (model: Model) => Option.some(model.photo),
  write: (model: Model, photo: Photo.Model) => modifyFields(model, { photo: () => photo }),
  toParentMessage: (message: Photo.Message) => Message.GotPhotoMessage({ message }),
  foldOutMessage: Photo.OutMessage.match<Update.Step<Model, Message, Services>>({
    DeletedPhoto: () => (stepModel) => ({ model: stepModel, commands: [Navigate({ href: photosRouter({}) })] }),
  }),
})

const foldBoardsRevisit = Update.foldChildStep({
  update: Boards.revisit,
  read: (model: Model) => Option.some(model.boards),
  write: (model: Model, boards: Boards.Model) => modifyFields(model, { boards: () => boards }),
  toParentMessage: (message: Boards.Message) => Message.GotBoardsMessage({ message }),
})

const foldTodayEnter = Update.foldChildStep({
  update: Today.enter,
  read: (model: Model) => Option.some(model.today),
  write: (model: Model, today: Today.Model) => modifyFields(model, { today: () => today }),
  toParentMessage: (message: Today.Message) => Message.GotTodayMessage({ message }),
})

export const foldAskLeave = Update.foldChildStep({
  update: Ask.leave,
  read: (model: Model) => Option.some(model.ask),
  write: (model: Model, ask: Ask.Model) => modifyFields(model, { ask: () => ask }),
  toParentMessage: (message: Ask.Message) => Message.GotAskMessage({ message }),
})

const foldAskEnter = (query: Option.Option<string>) =>
  Update.foldChildStep({
    update: Ask.enter(query),
    read: (model: Model) => Option.some(model.ask),
    write: (model: Model, ask: Ask.Model) => modifyFields(model, { ask: () => ask }),
    toParentMessage: (message: Ask.Message) => Message.GotAskMessage({ message }),
  })

const foldExploreEnter = Update.foldChildStep({
  update: Visit.enterExplore,
  read: (model: Model) => Option.some(model.visit),
  write: (model: Model, visit: Visit.Model) => modifyFields(model, { visit: () => visit }),
  toParentMessage: (message: Visit.Message) => Message.GotVisitMessage({ message }),
})

const foldAccountEnter = Update.foldChildStep({
  update: Account.enter,
  read: (model: Model) => Option.some(model.account),
  write: (model: Model, account: Account.Model) => modifyFields(model, { account: () => account }),
  toParentMessage: (message: Account.Message) => Message.GotAccountMessage({ message }),
})

export const openHome: ReadonlyArray<Step> = [foldTodayEnter, foldWardrobeRevisit]
/** What opening a tab page asks for. Home needs a session: a cookie with the request, or `afterSignIn`. */
export const openPage = (route: AppRoute, hasSessionCookie: boolean): ReadonlyArray<Step> =>
  Match.value(route).pipe(
    // Signed out, Home is the landing, which shows Edits from Styld.
    Match.tag('Home', () => (hasSessionCookie ? openHome : [foldExploreEnter])),
    Match.tag('Wardrobe', () => [foldWardrobeEnter]),
    Match.tag('Ask', ({ q }) => [foldWardrobeRevisit, foldAskEnter(q)]),
    Match.tag('Looks', () => [foldLooksRevisit]),
    Match.tag('Photos', () => [foldPhotosRevisit]),
    Match.tag('Boards', () => [foldBoardsRevisit]),
    Match.tag('Explore', () => [foldExploreEnter]),
    // The account needs a session; signed out the page sends the visitor to sign in.
    Match.tag('Account', () => (hasSessionCookie ? [foldAccountEnter] : [])),
    Match.orElse(() => []),
  )

/** Boards inside the app: a board made from anywhere opens as soon as it is made. */
export const boardsFold = {
  read: (model: Model) => Option.some(model.boards),
  write: (model: Model, boards: Boards.Model) => modifyFields(model, { boards: () => boards }),
  toParentMessage: (message: Boards.Message) => Message.GotBoardsMessage({ message }),
  foldOutMessage: Boards.OutMessage.match<Update.Step<Model, Message, Services>>({
    CreatedBoard:
      ({ boardId }) =>
      (stepModel) => ({ model: stepModel, commands: [Navigate({ href: boardRouter({ boardId }) })] }),
  }),
}
/** Start a board from outside Boards (Ask's + sheet), through Boards' own step. */
export const foldStartBoard = (defaultName: string) =>
  Update.foldChildStep({ update: Boards.startBoard(defaultName), ...boardsFold })

/** The landing's Try again, through Visit's own step. */
export const foldVisitRetry = Update.foldChildStep({
  update: Visit.retry,
  read: (model: Model) => Option.some(model.visit),
  write: (model: Model, visit: Visit.Model) => modifyFields(model, { visit: () => visit }),
  toParentMessage: (message: Visit.Message) => Message.GotVisitMessage({ message }),
})
