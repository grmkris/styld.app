import { TryOnId } from '@styld/protocol'
import { Match, Option, Schema } from 'effect'
import { type Command, Update } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Message } from './Message.ts'
import * as Account from './page/Account.ts'
import * as AddPiecesMessage from './page/AddPieces/Message.ts'
import * as AddPieces from './page/AddPieces/Model.ts'
import { ReadAllowance } from './page/AddPieces/Commands.ts'
import * as Ask from './page/Ask.ts'
import * as BoardMessage from './page/Board/Message.ts'
import * as BoardModel from './page/Board/Model.ts'
import * as Board from './page/Board/Update.ts'
import * as Boards from './page/Boards.ts'
import * as Login from './page/Login.ts'
import * as Look from './page/Look.ts'
import * as Looks from './page/Looks.ts'
import * as Photo from './page/Photo.ts'
import * as Photos from './page/Photos.ts'
import * as Piece from './page/Piece.ts'
import * as ProfileEditor from './page/ProfileEditor.ts'
import * as Review from './page/Review.ts'
import * as Stylist from './page/Stylist.ts'
import * as TryOn from './page/TryOn.ts'
import * as Today from './page/Today.ts'
import * as Landing from './page/Landing.ts'
import * as Visit from './page/Visit.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import { AppRoute } from './route.ts'
import type { StyldClient } from './StyldClient.ts'
import type { PictureEncoder } from './Upload.ts'
import type * as SecureRandom from 'effect/crypto/SecureRandom'

// The page a document shows. Tab pages switch inside the document and keep their place, so they live together; every
// other page loads whole (Navigation.ts), so it is the only one there is. A page's Model exists only while it is
// open: its Subscriptions and folds read it through its lens and stop when it is gone.

// MODEL

/** The tab pages, each as the person left it, and the public boards the landing a signed-out Home shows. */
const Tabs = Schema.Struct({
  today: Today.Model,
  wardrobe: Wardrobe.Model,
  looks: Looks.Model,
  photos: Photos.Model,
  tryOn: TryOn.Model,
  ask: Ask.Model,
  boards: Boards.Model,
  account: Account.Model,
  landing: Landing.Model,
})
type Tabs = typeof Tabs.Type

export const Page = defineTaggedUnion({
  Tabs: { tabs: Tabs },
  Login: { login: Login.Model },
  Profile: { profile: ProfileEditor.Model },
  AddPieces: { addPieces: AddPieces.Model },
  Review: { review: Review.Model },
  Piece: { piece: Piece.Model },
  Look: { look: Look.Model },
  Photo: { photo: Photo.Model },
  /** One try-on beside its photo. */
  TryOnPage: { tryOnPage: TryOn.Model },
  Stylist: { stylist: Stylist.Model },
  /** A board's page and its collage editor. */
  Board: { board: BoardModel.Model },
  /** A person's public profile, or one of their pieces. */
  Visit: { visit: Visit.Model },
  /** The privacy policy or the terms: words only, with no Model of their own. */
  Legal: {},
  NotFound: {},
})
export type Page = typeof Page.Type

// LENS

/** Where one page's Model sits in the document's page, and how its Messages reach the app: the one lens its folds,
 * Subscriptions and view share. */
export type PageLens<Child, ChildMessage> = Readonly<{
  slot: string
  read: (page: Page) => Option.Option<Child>
  write: (page: Page, child: Child) => Page
  toParentMessage: (message: ChildMessage) => Message
}>

/** A page that is the document's only one: writing it makes it the page. */
type OnlyPageLens<Child, ChildMessage> = PageLens<Child, ChildMessage> & Readonly<{ make: (child: Child) => Page }>

const onlyPage = <Child, ChildMessage>(
  slot: string,
  read: (page: Page) => Option.Option<Child>,
  make: (child: Child) => Page,
  toParentMessage: (message: ChildMessage) => Message,
): OnlyPageLens<Child, ChildMessage> => ({ slot, read, make, write: (_page, child) => make(child), toParentMessage })

const tab = <Child, ChildMessage>(
  slot: string,
  get: (tabs: Tabs) => Child,
  set: (tabs: Tabs, child: Child) => Tabs,
  toParentMessage: (message: ChildMessage) => Message,
): PageLens<Child, ChildMessage> => ({
  slot,
  read: (page) => (Page.guards.Tabs(page) ? Option.some(get(page.tabs)) : Option.none()),
  write: (page, child) => (Page.guards.Tabs(page) ? Page.Tabs({ tabs: set(page.tabs, child) }) : page),
  toParentMessage,
})

export const lenses = {
  today: tab(
    'today',
    (tabs) => tabs.today,
    (tabs, today: Today.Model) => modifyFields(tabs, { today: () => today }),
    (message: Today.Message) => Message.GotTodayMessage({ message }),
  ),
  wardrobe: tab(
    'wardrobe',
    (tabs) => tabs.wardrobe,
    (tabs, wardrobe: Wardrobe.Model) => modifyFields(tabs, { wardrobe: () => wardrobe }),
    (message: Wardrobe.Message) => Message.GotWardrobeMessage({ message }),
  ),
  looks: tab(
    'looks',
    (tabs) => tabs.looks,
    (tabs, looks: Looks.Model) => modifyFields(tabs, { looks: () => looks }),
    (message: Looks.Message) => Message.GotLooksMessage({ message }),
  ),
  photos: tab(
    'photos',
    (tabs) => tabs.photos,
    (tabs, photos: Photos.Model) => modifyFields(tabs, { photos: () => photos }),
    (message: Photos.Message) => Message.GotPhotosMessage({ message }),
  ),
  tryOn: tab(
    'try-on',
    (tabs) => tabs.tryOn,
    (tabs, tryOn: TryOn.Model) => modifyFields(tabs, { tryOn: () => tryOn }),
    (message: TryOn.Message) => Message.GotTryOnMessage({ message }),
  ),
  ask: tab(
    'ask',
    (tabs) => tabs.ask,
    (tabs, ask: Ask.Model) => modifyFields(tabs, { ask: () => ask }),
    (message: Ask.Message) => Message.GotAskMessage({ message }),
  ),
  boards: tab(
    'boards',
    (tabs) => tabs.boards,
    (tabs, boards: Boards.Model) => modifyFields(tabs, { boards: () => boards }),
    (message: Boards.Message) => Message.GotBoardsMessage({ message }),
  ),
  account: tab(
    'account',
    (tabs) => tabs.account,
    (tabs, account: Account.Model) => modifyFields(tabs, { account: () => account }),
    (message: Account.Message) => Message.GotAccountMessage({ message }),
  ),
  landing: tab(
    'landing',
    (tabs) => tabs.landing,
    (tabs, landing: Landing.Model) => modifyFields(tabs, { landing: () => landing }),
    (message: Landing.Message) => Message.GotLandingMessage({ message }),
  ),
  login: onlyPage(
    'login',
    Match.type<Page>().pipe(
      Match.tag('Login', ({ login }) => login),
      Match.option,
    ),
    (login) => Page.Login({ login }),
    (message: Login.Message) => Message.GotLoginMessage({ message }),
  ),
  profile: onlyPage(
    'profile',
    Match.type<Page>().pipe(
      Match.tag('Profile', ({ profile }) => profile),
      Match.option,
    ),
    (profile) => Page.Profile({ profile }),
    (message: ProfileEditor.Message) => Message.GotProfileMessage({ message }),
  ),
  addPieces: onlyPage(
    'add-pieces',
    Match.type<Page>().pipe(
      Match.tag('AddPieces', ({ addPieces }) => addPieces),
      Match.option,
    ),
    (addPieces) => Page.AddPieces({ addPieces }),
    (message: AddPiecesMessage.Message) => Message.GotAddPiecesMessage({ message }),
  ),
  review: onlyPage(
    'review',
    Match.type<Page>().pipe(
      Match.tag('Review', ({ review }) => review),
      Match.option,
    ),
    (review) => Page.Review({ review }),
    (message: Review.Message) => Message.GotReviewMessage({ message }),
  ),
  piece: onlyPage(
    'piece',
    Match.type<Page>().pipe(
      Match.tag('Piece', ({ piece }) => piece),
      Match.option,
    ),
    (piece) => Page.Piece({ piece }),
    (message: Piece.Message) => Message.GotPieceMessage({ message }),
  ),
  look: onlyPage(
    'look',
    Match.type<Page>().pipe(
      Match.tag('Look', ({ look }) => look),
      Match.option,
    ),
    (look) => Page.Look({ look }),
    (message: Look.Message) => Message.GotLookMessage({ message }),
  ),
  photo: onlyPage(
    'photo',
    Match.type<Page>().pipe(
      Match.tag('Photo', ({ photo }) => photo),
      Match.option,
    ),
    (photo) => Page.Photo({ photo }),
    (message: Photo.Message) => Message.GotPhotoMessage({ message }),
  ),
  tryOnPage: onlyPage(
    'try-on-page',
    Match.type<Page>().pipe(
      Match.tag('TryOnPage', ({ tryOnPage }) => tryOnPage),
      Match.option,
    ),
    (tryOnPage) => Page.TryOnPage({ tryOnPage }),
    (message: TryOn.Message) => Message.GotTryOnPageMessage({ message }),
  ),
  stylist: onlyPage(
    'stylist',
    Match.type<Page>().pipe(
      Match.tag('Stylist', ({ stylist }) => stylist),
      Match.option,
    ),
    (stylist) => Page.Stylist({ stylist }),
    (message: Stylist.Message) => Message.GotStylistMessage({ message }),
  ),
  board: onlyPage(
    'board',
    Match.type<Page>().pipe(
      Match.tag('Board', ({ board }) => board),
      Match.option,
    ),
    (board) => Page.Board({ board }),
    (message: BoardMessage.Message) => Message.GotBoardMessage({ message }),
  ),
  visit: onlyPage(
    'visit',
    Match.type<Page>().pipe(
      Match.tag('Visit', ({ visit }) => visit),
      Match.option,
    ),
    (visit) => Page.Visit({ visit }),
    (message: Visit.Message) => Message.GotVisitMessage({ message }),
  ),
}

// INIT

/** The tab pages as they first open: each tab asks for its own when it is entered. */
const tabs = (): Page =>
  Page.Tabs({
    tabs: {
      today: Today.init(),
      wardrobe: Wardrobe.init(),
      looks: Looks.init(),
      photos: Photos.init(),
      tryOn: TryOn.init(),
      ask: Ask.init(),
      boards: Boards.init(),
      account: Account.init(),
      landing: Landing.init(),
    },
  })

/** What opening a page needs from the browser. */
type PageServices = StyldClient | SecureRandom.SecureRandom | PictureEncoder
type Opened = Update.Return<Page, Message, PageServices>

/** A page opened with what it asks for first, through its lens. */
const opened = <Child, ChildMessage>(
  lens: OnlyPageLens<Child, ChildMessage>,
  model: Child,
  commands: ReadonlyArray<Command.Command<ChildMessage, never, PageServices>>,
): Opened =>
  Update.foldChildInit({ model, commands }, { toParentModel: lens.make, toParentMessage: lens.toParentMessage })

/** The page a route opens, before any tab is entered. `signedIn` is the session cookie's hint; `atFollow` a public
 * profile opened at `#follow`, where sign-in returns a Follow pressed signed out. */
export const openPage = (route: AppRoute, signedIn: boolean, atFollow: boolean): Opened =>
  Match.value(route).pipe(
    Match.withReturnType<Opened>(),
    Match.tag('Home', 'Wardrobe', 'Looks', 'Photos', 'TryOn', 'Ask', 'Boards', 'Account', () => ({
      model: tabs(),
    })),
    Match.tag('Login', 'LoginForConnection', () => opened(lenses.login, Login.init(), [])),
    Match.tag('Profile', () => opened(lenses.profile, ProfileEditor.init(), ProfileEditor.load())),
    Match.tag('AddPieces', () => opened(lenses.addPieces, AddPieces.init(), [ReadAllowance()])),
    Match.tag('Review', () => opened(lenses.review, Review.init(), Review.load())),
    Match.tag('Piece', ({ pieceId }) => {
      const piece = Piece.init(pieceId)
      return opened(lenses.piece, piece, Piece.load(piece))
    }),
    Match.tag('Look', ({ lookId }) => {
      const look = Look.init(lookId)
      return opened(lenses.look, look, Look.load(look))
    }),
    Match.tag('Photo', ({ photoId }) => {
      const photo = Photo.init(photoId)
      return opened(lenses.photo, photo, Photo.load(photo))
    }),
    Match.tag('TryOnPage', ({ tryOnId }) =>
      Option.match(Schema.decodeUnknownOption(TryOnId)(tryOnId), {
        onNone: () => ({ model: Page.NotFound() }),
        onSome: (id) => opened(lenses.tryOnPage, TryOn.initOpen(id), TryOn.load()),
      }),
    ),
    Match.tag('Stylist', ({ q }) => opened(lenses.stylist, Stylist.init(q), Stylist.load())),
    Match.tag('Board', 'BoardCollage', ({ boardId }) => {
      const board = BoardModel.init(boardId)
      return opened(lenses.board, board, Board.load(board, { signedIn }))
    }),
    Match.tag('Person', ({ handle }) => {
      const visit = Visit.init(Visit.Target.Person({ handle }), atFollow)
      return opened(lenses.visit, visit, Visit.load(visit))
    }),
    Match.tag('PublicPiece', ({ pieceId }) => {
      const visit = Visit.init(Visit.Target.Piece({ pieceId }))
      return opened(lenses.visit, visit, Visit.load(visit))
    }),
    Match.tag('Privacy', 'Terms', () => ({ model: Page.Legal() })),
    Match.tag('NotFound', () => ({ model: Page.NotFound() })),
    Match.exhaustive,
  )
