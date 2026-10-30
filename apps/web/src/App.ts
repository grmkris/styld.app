import { Effect, Match, Option, Schema } from 'effect'
import { BrowserAuth } from '@styld/auth/client'
import { AccountClaims } from '@styld/auth/config'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { Command, Subscription, Update } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { catalogVersion, loadCatalog } from '@styld/i18n'
import { Locale, localeEndpoint, parseLocale } from './Locale.ts'
import { Message } from './Message.ts'
import { arrive, followLink, Navigate } from './Navigation.ts'
import { foldAskLeave, foldWardrobeRevisit, openHome, openPage, type Step } from './PageEntries.ts'
import * as Crypto from 'effect/Crypto'
import * as AddPiecesMessage from './page/AddPieces/Message.ts'
import * as AddPiecesModel from './page/AddPieces/Model.ts'
import * as AddPiecesSubscription from './page/AddPieces/Subscription.ts'
import * as AddPieces from './page/AddPieces/Update.ts'
import * as Account from './page/Account.ts'
import * as Ask from './page/Ask.ts'
import * as Today from './page/Today.ts'
import * as BoardMessage from './page/Board/Message.ts'
import * as BoardModel from './page/Board/Model.ts'
import * as BoardSubscription from './page/Board/Subscription.ts'
import * as Board from './page/Board/Update.ts'
import * as Boards from './page/Boards.ts'
import * as Login from './page/Login.ts'
import * as Look from './page/Look.ts'
import * as Looks from './page/Looks.ts'
import * as Piece from './page/Piece.ts'
import * as Review from './page/Review.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import {
  AppRoute,
  accountRouter,
  boardRouter,
  connectionAuthorizePath,
  homeRouter,
  isSameTab,
  loginRouter,
  looksRouter,
  needsSession,
  reviewRouter,
  routeFromPathname,
  routeFromUrl,
  tabOf,
  wardrobeRouter,
} from './route.ts'
import { type Url, toString as urlToString } from 'foldkit/url'
import type { StyldClient } from './StyldClient.ts'
import { TelemetryConsent, TelemetryConsentControl } from './TelemetryConsent.ts'

// MODEL

export const Flags = Schema.Struct({
  locale: Locale,
  catalogVersion: Schema.Literal(catalogVersion),
  timeZone: Schema.String,
  referenceTime: Schema.Number,
  pathname: Schema.String,
  /** The public origin the page was served from: assistants connect to its `/mcp`. */
  origin: Schema.String,
  telemetryConsent: TelemetryConsent,
  /** A session cookie came with the request: Home waits for the session instead of showing the landing page
   * to someone who is signed in. Only a hint; the session is read in the browser. */
  hasSessionCookie: Schema.optionalKey(Schema.Boolean),
})
export type Flags = typeof Flags.Type

export const LocaleSave = defineTaggedUnion({ Saved: {}, Saving: { locale: Locale }, Failed: {} })

/** The visitor's session as the browser last read it. */
export const Session = defineTaggedUnion({
  Checking: {},
  SignedOut: {},
  SignedIn: { claims: AccountClaims },
  SigningOut: { claims: AccountClaims },
  Unavailable: {},
})

export const Model = Schema.Struct({
  context: Flags,
  route: AppRoute,
  localeSave: LocaleSave,
  session: Session,
  login: Login.Model,
  wardrobe: Wardrobe.Model,
  piece: Piece.Model,
  addPieces: AddPiecesModel.Model,
  review: Review.Model,
  looks: Looks.Model,
  look: Look.Model,
  today: Today.Model,
  ask: Ask.Model,
  boards: Boards.Model,
  board: BoardModel.Model,
  account: Account.Model,
  telemetry: Schema.Struct({ consent: TelemetryConsent, prompting: Schema.Boolean }),
})
export type Model = typeof Model.Type

// MESSAGE

export { Message }

// COMMAND

/** @internal Exported for its tests. */
export const ReadSession = Command.define('ReadSession', {
  messages: [Message.ReceivedSession, Message.FailedReadSession],
  execute: Effect.gen(function* () {
    const { auth } = yield* BrowserAuth
    const session = yield* auth.getSession()
    return Message.ReceivedSession({ claims: session?.claims ?? null })
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedReadSession()))),
})

/** @internal Exported for its tests. */
export const SignOut = Command.define('SignOut', {
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: Effect.gen(function* () {
    yield* (yield* BrowserAuth).auth.signOut()
    return Message.SucceededSignOut()
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedSignOut()))),
})

const SaveLocale = Command.define('SaveLocale', {
  args: { locale: Locale },
  messages: [Message.SucceededSaveLocale, Message.FailedSaveLocale],
  execute: ({ locale }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      yield* HttpClient.filterStatusOk(client).execute(
        HttpClientRequest.post(localeEndpoint).pipe(HttpClientRequest.bodyUrlParams({ locale })),
      )
      // The new language's messages arrive before the page switches to them.
      yield* Effect.promise(() => loadCatalog(locale))
      return Message.SucceededSaveLocale({ locale })
    }).pipe(Effect.catchTag('HttpClientError', () => Effect.succeed(Message.FailedSaveLocale()))),
})

const RecordTelemetryConsent = Command.define('RecordTelemetryConsent', {
  args: { granted: Schema.Boolean },
  messages: [Message.RecordedTelemetryConsent],
  execute: ({ granted }) =>
    Effect.gen(function* () {
      yield* (yield* TelemetryConsentControl).record(granted)
      return Message.RecordedTelemetryConsent({ granted })
    }),
})

export type Services =
  | HttpClient.HttpClient
  | BrowserAuth
  | Login.EmailSignIn
  | TelemetryConsentControl
  | StyldClient
  | Crypto.Crypto
type UpdateReturn = Update.Return<Model, Message, Services>

// INIT

/** The Commands that open a page that loads whole each time. */
const pageCommands = (route: AppRoute, piece: Piece.Model, look: Look.Model, board: BoardModel.Model) =>
  Match.value(route).pipe(
    Match.tag('Board', () => Command.mapMessages(Board.load(board), (message) => Message.GotBoardMessage({ message }))),
    Match.tag('Piece', () => Command.mapMessages(Piece.load(piece), (message) => Message.GotPieceMessage({ message }))),
    Match.tag('Review', () => Command.mapMessages(Review.load(), (message) => Message.GotReviewMessage({ message }))),
    Match.tag('Look', () => Command.mapMessages(Look.load(look), (message) => Message.GotLookMessage({ message }))),
    Match.orElse(() => []),
  )

/** The page opens at the URL the browser or the server hands over; tests may give the path in the Flags alone. */
export const init = (context: Flags, url?: Url): UpdateReturn => {
  const route = url === undefined ? routeFromPathname(context.pathname) : routeFromUrl(url)
  const piece = Piece.init(AppRoute.guards.Piece(route) ? route.pieceId : '')
  const look = Look.init(AppRoute.guards.Look(route) ? route.lookId : '')
  const board = BoardModel.init(AppRoute.guards.Board(route) ? route.boardId : '')
  const opened = Update.combine<Model, Message, Services>(
    {
      context,
      route,
      localeSave: LocaleSave.Saved(),
      session: Session.Checking(),
      login: Login.init(),
      wardrobe: Wardrobe.init(),
      piece,
      addPieces: AddPiecesModel.init(),
      review: Review.init(),
      looks: Looks.init(),
      look,
      today: Today.init(),
      ask: Ask.init(),
      boards: Boards.init(),
      board,
      account: Account.init(),
      telemetry: { consent: context.telemetryConsent, prompting: context.telemetryConsent === 'undecided' },
    },
    openPage(route, context.hasSessionCookie === true),
  )
  return {
    model: opened.model,
    commands: [ReadSession(), ...pageCommands(route, piece, look, board), ...(opened.commands ?? [])],
  }
}

// UPDATE

/** The address changed in the page: its tab opens with what the app has, refreshed behind; any other page loads. */
const changedUrl = (model: Model, url: Url): UpdateReturn => {
  const route = routeFromUrl(url)
  if (Option.isNone(tabOf(route))) return { model, commands: [Navigate({ href: urlToString(url) })] }
  const moved = modifyFields(model, { route: () => route })
  if (isSameTab(model.route, route))
    return Option.isSome(url.hash) ? { model: moved, commands: arrive(url.hash) } : { model: moved }
  return Update.combine<Model, Message, Services>(moved, [
    foldAskLeave,
    ...openPage(route, true),
    (stepModel) => ({ model: stepModel, commands: arrive(url.hash) }),
  ])
}

/** Where a signed-in visitor belongs: sign-in hands over to the account or the assistant's authorization. */
const afterSignIn =
  (route: AppRoute): Step =>
  (model) =>
    Match.value(route).pipe(
      Match.withReturnType<UpdateReturn>(),
      Match.tag('Login', () => ({ model, commands: [Navigate({ href: accountRouter({}) })] })),
      Match.tag('LoginForConnection', () => ({ model, commands: [Navigate({ href: connectionAuthorizePath })] })),
      Match.tag('Home', () =>
        model.context.hasSessionCookie === true ? { model } : Update.combine<Model, Message, Services>(model, openHome),
      ),
      Match.orElse(() => ({ model })),
    )

/** Pages that need a session send a signed-out visitor to sign in. */
const afterSignOut = (route: AppRoute) => (needsSession(route) ? [Navigate({ href: loginRouter({}) })] : [])

const foldLoginOutMessage = Login.OutMessage.match<Update.Step<Model, Message, Services>>({
  SignedIn:
    ({ claims }) =>
    (stepModel) =>
      afterSignIn(stepModel.route)(modifyFields(stepModel, { session: () => Session.SignedIn({ claims }) })),
})

const foldLogin = Update.foldChild({
  update: Login.update,
  read: (model: Model) => Option.some(model.login),
  write: (model: Model, nextLogin: Login.Model) => modifyFields(model, { login: () => nextLogin }),
  toParentMessage: (message: Login.Message) => Message.GotLoginMessage({ message }),
  foldOutMessage: foldLoginOutMessage,
})

/** Sign out of the session the page holds. */
const requestSignOut = (model: Model): Update.Return<Model, Message, Services> => {
  const { session } = model
  if (!Session.guards.SignedIn(session)) return { model }
  return {
    model: modifyFields(model, { session: () => Session.SigningOut({ claims: session.claims }) }),
    commands: [SignOut()],
  }
}

const foldAccount = Update.foldChild({
  update: Account.update,
  read: (model: Model) => Option.some(model.account),
  write: (model: Model, account: Account.Model) => modifyFields(model, { account: () => account }),
  toParentMessage: (message: Account.Message) => Message.GotAccountMessage({ message }),
  foldOutMessage: Account.OutMessage.match<Update.Step<Model, Message, Services>>({
    RequestedSignOut: () => requestSignOut,
    // The account is gone with its session: the visitor starts over on the home page.
    DeletedAccount: () => (stepModel) => ({
      model: modifyFields(stepModel, { session: () => Session.SignedOut() }),
      commands: [Navigate({ href: homeRouter({}) })],
    }),
  }),
})

const foldWardrobe = Update.foldChild({
  update: Wardrobe.update,
  read: (model: Model) => Option.some(model.wardrobe),
  write: (model: Model, wardrobe: Wardrobe.Model) => modifyFields(model, { wardrobe: () => wardrobe }),
  toParentMessage: (message: Wardrobe.Message) => Message.GotWardrobeMessage({ message }),
})

const foldPiece = Update.foldChild({
  update: Piece.update,
  read: (model: Model) => Option.some(model.piece),
  write: (model: Model, piece: Piece.Model) => modifyFields(model, { piece: () => piece }),
  toParentMessage: (message: Piece.Message) => Message.GotPieceMessage({ message }),
  foldOutMessage: Piece.OutMessage.match<Update.Step<Model, Message, Services>>({
    DeletedPiece: () => (stepModel) => ({ model: stepModel, commands: [Navigate({ href: wardrobeRouter({}) })] }),
  }),
})

const foldLooks = Update.foldChild({
  update: Looks.update,
  read: (model: Model) => Option.some(model.looks),
  write: (model: Model, looks: Looks.Model) => modifyFields(model, { looks: () => looks }),
  toParentMessage: (message: Looks.Message) => Message.GotLooksMessage({ message }),
})

const foldLook = Update.foldChild({
  update: Look.update,
  read: (model: Model) => Option.some(model.look),
  write: (model: Model, look: Look.Model) => modifyFields(model, { look: () => look }),
  toParentMessage: (message: Look.Message) => Message.GotLookMessage({ message }),
  foldOutMessage: Look.OutMessage.match<Update.Step<Model, Message, Services>>({
    DeletedLook: () => (stepModel) => ({ model: stepModel, commands: [Navigate({ href: looksRouter({}) })] }),
  }),
})

const foldToday = Update.foldChild({
  update: Today.update,
  read: (model: Model) => Option.some(model.today),
  write: (model: Model, today: Today.Model) => modifyFields(model, { today: () => today }),
  toParentMessage: (message: Today.Message) => Message.GotTodayMessage({ message }),
  foldOutMessage: Today.OutMessage.match<Step>({ RequestedPieces: () => foldWardrobeRevisit }),
})

const foldAsk = Update.foldChild({
  update: Ask.update,
  read: (model: Model) => Option.some(model.ask),
  write: (model: Model, ask: Ask.Model) => modifyFields(model, { ask: () => ask }),
  toParentMessage: (message: Ask.Message) => Message.GotAskMessage({ message }),
  foldOutMessage: Ask.OutMessage.match<Step>({ RequestedPieces: () => foldWardrobeRevisit }),
})

const foldBoards = Update.foldChild({
  update: Boards.update,
  read: (model: Model) => Option.some(model.boards),
  write: (model: Model, boards: Boards.Model) => modifyFields(model, { boards: () => boards }),
  toParentMessage: (message: Boards.Message) => Message.GotBoardsMessage({ message }),
  foldOutMessage: Boards.OutMessage.match<Update.Step<Model, Message, Services>>({
    CreatedBoard:
      ({ boardId }) =>
      (stepModel) => ({ model: stepModel, commands: [Navigate({ href: boardRouter({ boardId }) })] }),
  }),
})

const foldBoard = Update.foldChild({
  update: Board.update,
  read: (model: Model) => Option.some(model.board),
  write: (model: Model, board: BoardModel.Model) => modifyFields(model, { board: () => board }),
  toParentMessage: (message: BoardMessage.Message) => Message.GotBoardMessage({ message }),
})

const foldAddPieces = Update.foldChild({
  update: AddPieces.update,
  read: (model: Model) => Option.some(model.addPieces),
  write: (model: Model, addPieces: AddPiecesModel.Model) => modifyFields(model, { addPieces: () => addPieces }),
  toParentMessage: (message: AddPiecesMessage.Message) => Message.GotAddPiecesMessage({ message }),
  foldOutMessage: AddPiecesMessage.OutMessage.match<Update.Step<Model, Message, Services>>({
    FinishedSending: () => (stepModel) => ({ model: stepModel, commands: [Navigate({ href: reviewRouter({}) })] }),
  }),
})

/** Ongoing work the pages ask for. The add page keeps its own after the person moves on: a video still
 * being sent keeps the screen on wherever they are. */
export const subscriptions = Subscription.aggregate(
  Subscription.lift(AddPiecesSubscription.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.addPieces),
    toParentMessage: (message) => Message.GotAddPiecesMessage({ message }),
  }),
  // The pieces are asked for again while one is processing, whichever page shows them.
  Subscription.lift(Wardrobe.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.wardrobe),
    toParentMessage: (message) => Message.GotWardrobeMessage({ message }),
  }),
  // The board's hands, keys, pasted pictures and dropped files listen only while a board is open.
  Subscription.lift(BoardSubscription.subscriptions)<Model, Message>({
    read: (model) => (AppRoute.guards.Board(model.route) ? Option.some(model.board) : Option.none()),
    toParentMessage: (message) => Message.GotBoardMessage({ message }),
  }),
)

const foldReview = Update.foldChild({
  update: Review.update,
  read: (model: Model) => Option.some(model.review),
  write: (model: Model, review: Review.Model) => modifyFields(model, { review: () => review }),
  toParentMessage: (message: Review.Message) => Message.GotReviewMessage({ message }),
  foldOutMessage: Review.OutMessage.match<Update.Step<Model, Message, Services>>({
    AddedPieces: () => (stepModel) => ({ model: stepModel, commands: [Navigate({ href: wardrobeRouter({}) })] }),
  }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SelectedLocale: ({ value }) => {
      const locale = parseLocale(value)
      if (locale === undefined || LocaleSave.guards.Saving(model.localeSave)) return { model }
      return {
        model: modifyFields(model, { localeSave: () => LocaleSave.Saving({ locale }) }),
        commands: [SaveLocale({ locale })],
      }
    },
    SucceededSaveLocale: ({ locale }) => ({
      model: modifyFields(model, {
        context: (context) => modifyFields(context, { locale: () => locale }),
        localeSave: () => LocaleSave.Saved(),
      }),
    }),
    FailedSaveLocale: () => ({ model: modifyFields(model, { localeSave: () => LocaleSave.Failed() }) }),
    ReceivedSession: ({ claims }) =>
      claims === null
        ? { model: modifyFields(model, { session: () => Session.SignedOut() }), commands: afterSignOut(model.route) }
        : afterSignIn(model.route)(modifyFields(model, { session: () => Session.SignedIn({ claims }) })),
    FailedReadSession: () => ({ model: modifyFields(model, { session: () => Session.Unavailable() }) }),
    RequestedSession: () => ({
      model: modifyFields(model, { session: () => Session.Checking() }),
      commands: [ReadSession()],
    }),
    SucceededSignOut: () => ({
      model: modifyFields(model, { session: () => Session.SignedOut() }),
      commands: afterSignOut(model.route),
    }),
    FailedSignOut: () => ({ model: modifyFields(model, { session: () => Session.Unavailable() }) }),
    CompletedNavigate: () => ({ model }),
    ClickedLink: ({ request }) => ({
      model,
      commands: followLink(model.route, Session.guards.SignedIn(model.session), request),
    }),
    ChangedUrl: ({ url }) => changedUrl(model, url),
    CompletedNavigateInternal: () => ({ model }),
    CompletedScrollToTop: () => ({ model }),
    CompletedScrollToAnchor: () => ({ model }),
    CompletedFocusPageTitle: () => ({ model }),
    GotLoginMessage: (got) => foldLogin(model, got.message),
    GotAccountMessage: (got) => foldAccount(model, got.message),
    GotWardrobeMessage: (got) => foldWardrobe(model, got.message),
    GotPieceMessage: (got) => foldPiece(model, got.message),
    GotAddPiecesMessage: (got) => foldAddPieces(model, got.message),
    GotReviewMessage: (got) => foldReview(model, got.message),
    GotLooksMessage: (got) => foldLooks(model, got.message),
    GotLookMessage: (got) => foldLook(model, got.message),
    GotTodayMessage: (got) => foldToday(model, got.message),
    GotAskMessage: (got) => foldAsk(model, got.message),
    GotBoardsMessage: (got) => foldBoards(model, got.message),
    GotBoardMessage: (got) => foldBoard(model, got.message),
    ChoseTelemetryConsent: ({ granted }) => ({
      model: modifyFields(model, { telemetry: (telemetry) => modifyFields(telemetry, { prompting: () => false }) }),
      commands: [RecordTelemetryConsent({ granted })],
    }),
    RecordedTelemetryConsent: ({ granted }) => {
      const consent: TelemetryConsent = granted ? 'granted' : 'denied'
      return { model: modifyFields(model, { telemetry: () => ({ consent, prompting: false }) }) }
    },
    OpenedTelemetrySettings: () => ({
      model: modifyFields(model, { telemetry: (telemetry) => modifyFields(telemetry, { prompting: () => true }) }),
    }),
  })
