import { Effect, Match, Option, Predicate, Schema } from 'effect'
import type { Tone } from '@styld/protocol'
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
import { arrive, followLink, Navigate, ReplaceInternal, returnAfterSignIn } from './Navigation.ts'
import * as NavigationState from './NavigationState.ts'
import { at, data } from './AppLens.ts'
import { lenses, openPage, Page } from './Page.ts'
import * as ServerData from './ServerData.ts'
import * as Crypto from 'effect/Crypto'
import { ReadYou, You, youOf } from './You.ts'
import * as AddPiecesMessage from './page/AddPieces/Message.ts'
import * as AddPiecesSubscription from './page/AddPieces/Subscription.ts'
import * as AddPieces from './page/AddPieces/Update.ts'
import * as Account from './page/Account.ts'
import * as Ask from './page/Ask.ts'
import * as Today from './page/Today.ts'
import * as BoardSubscription from './page/Board/Subscription.ts'
import * as Board from './page/Board/Update.ts'
import { ownBoard, PinWork } from './page/Board/Model.ts'
import { sheetShown } from './page/Sheet.ts'
import * as Boards from './page/Boards.ts'
import * as Login from './page/Login.ts'
import * as Look from './page/Look.ts'
import * as ProfileEditor from './page/ProfileEditor.ts'
import * as Looks from './page/Looks.ts'
import * as Photo from './page/Photo.ts'
import * as Photos from './page/Photos.ts'
import * as Piece from './page/Piece.ts'
import * as Visit from './page/Visit.ts'
import * as Review from './page/Review.ts'
import * as Stylist from './page/Stylist.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import {
  AppRoute,
  boardRouter,
  connectionAuthorizePath,
  homeRouter,
  isSameTab,
  looksRouter,
  photosRouter,
  reviewRouter,
  routeFromUrl,
  routeMeta,
  signInHref,
  tabOf,
  wardrobeRouter,
} from './route.ts'
import { type Url, toString as urlToString } from 'foldkit/url'
import type { StyldClient } from './StyldClient.ts'
import type { PictureEncoder } from './Upload.ts'
import { TelemetryConsent, TelemetryConsentControl } from './TelemetryConsent.ts'
import { ReadTimeZone } from './TimeZone.ts'

// MODEL

export const Flags = Schema.Struct({
  locale: Locale,
  catalogVersion: Schema.Literal(catalogVersion),
  timeZone: Schema.String,
  referenceTime: Schema.Number,
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
  maybeWardrobeAnchor: Schema.Option(Schema.String),
  localeSave: LocaleSave,
  session: Session,
  you: You,
  /** What several pages show: the person's pieces. */
  data: ServerData.Model,
  /** The page the document shows (Page.ts). */
  page: Page,
  telemetry: Schema.Struct({ consent: TelemetryConsent, prompting: Schema.Boolean }),
})
export type Model = typeof Model.Type

/** Someone signed in, or on their way in with a session cookie: Home is their table rather than the landing page,
 * and public pages offer them Follow, Save and Report rather than a way to sign in. */
export const hasSession = (model: Model) =>
  Session.match(model.session, {
    SignedIn: () => true,
    SigningOut: () => true,
    Checking: () => model.context.hasSessionCookie === true,
    SignedOut: () => false,
    Unavailable: () => false,
  })

// MESSAGE

export { Message }

// COMMAND

export const ReadSession = Command.define('ReadSession', {
  messages: [Message.ReceivedSession, Message.FailedReadSession],
  execute: Effect.gen(function* () {
    const { auth } = yield* BrowserAuth
    const session = yield* auth.getSession()
    return Message.ReceivedSession({ claims: session?.claims ?? null })
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedReadSession()))),
})

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
      yield* Effect.tryPromise(() => loadCatalog(locale))
      const client = yield* HttpClient.HttpClient
      yield* HttpClient.filterStatusOk(client).execute(
        HttpClientRequest.post(localeEndpoint).pipe(HttpClientRequest.bodyUrlParams({ locale })),
      )
      return Message.SucceededSaveLocale({ locale })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSaveLocale())),
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

type Services =
  | HttpClient.HttpClient
  | BrowserAuth
  | Login.EmailSignIn
  | TelemetryConsentControl
  | StyldClient
  | Crypto.Crypto
  | PictureEncoder
type UpdateReturn = Update.Return<Model, Message, Services>
type Step = Update.Step<Model, Message, Services>

// LENS

const revisitPieces = Update.foldChildStep({ update: ServerData.revisitPieces, ...data })
const revisitBoards = Update.foldChildStep({ update: ServerData.revisitBoards, ...data })

const foldBoards = {
  ...at(lenses.boards),
  foldOutMessage: Boards.OutMessage.match<Step>({
    CreatedBoard: ({ boardId }) => NavigationState.navigateTo(boardRouter({ boardId })),
    RequestedBoards: () => revisitBoards,
  }),
}

/** Start a board from outside Boards (Ask's + sheet), through Boards' own step. */
const startBoard = (defaultName: string) =>
  Update.foldChildStep({ update: Boards.startBoard(defaultName), ...foldBoards })

// INIT

/** What entering a page asks for, on a first load and on every tab change: each page's own entry, and the pieces
 * where the page shows them. `signedIn` is the session cookie's hint, or a session just read. */
const entering = (route: AppRoute, signedIn: boolean): ReadonlyArray<Step> =>
  Match.value(route).pipe(
    Match.withReturnType<ReadonlyArray<Step>>(),
    // Signed out, Home is the landing, which shows Edits from Styld.
    Match.tag('Home', () =>
      signedIn
        ? [
            Update.foldChildStep({ update: Today.enter, ...at(lenses.today), foldOutMessage: foldTodayOut }),
            revisitPieces,
            revisitBoards,
          ]
        : [Update.foldChildStep({ update: Visit.enterExplore, ...at(lenses.explore) })],
    ),
    Match.tag('Wardrobe', () => [revisitPieces]),
    Match.tag('Ask', ({ q }) => [revisitPieces, Update.foldChildStep({ update: Ask.enter(q), ...at(lenses.ask) })]),
    Match.tag('Looks', () => [Update.foldChildStep({ update: Looks.revisit, ...at(lenses.looks) })]),
    Match.tag('Photos', () => [Update.foldChildStep({ update: Photos.revisit, ...at(lenses.photos) })]),
    // A board's table names its pieces by id; their pictures come with the person's pieces.
    Match.tag('Boards', () => [
      revisitBoards,
      revisitPieces,
      Update.foldChildStep({ update: Boards.revisit, ...at(lenses.boards) }),
    ]),
    Match.tag('Explore', () => [Update.foldChildStep({ update: Visit.enterExplore, ...at(lenses.explore) })]),
    // The account needs a session; signed out the page sends the visitor to sign in.
    Match.tag('Account', () =>
      signedIn ? [Update.foldChildStep({ update: Account.enter, ...at(lenses.account) })] : [],
    ),
    // Styld's answers name the person's pieces, and a photo's garments are matched to them.
    Match.tag('Stylist', 'Photo', () => [revisitPieces]),
    // A garment taken for one of the person's pieces shows that piece beside it.
    Match.tag('Review', () => [revisitPieces]),
    // The collage's tray shows the pieces; signed out a board can only be someone's public one.
    Match.tag('Board', 'BoardCollage', () => (signedIn ? [revisitPieces] : [])),
    Match.orElse(() => []),
  )

/** The page opens at the URL the browser or the server hands over. */
export const init = (context: Flags, url: Url): UpdateReturn => {
  const route = routeFromUrl(url)
  const signedIn = context.hasSessionCookie === true
  const page = openPage(route, signedIn, Option.contains(url.hash, 'follow'))
  const entered = Update.combine<Model, Message, Services>(
    {
      context,
      route,
      maybeWardrobeAnchor: AppRoute.guards.Wardrobe(route) ? url.hash : Option.none(),
      localeSave: LocaleSave.Saved(),
      session: Session.Checking(),
      you: You.Unknown(),
      data: ServerData.init(),
      page: page.model,
      telemetry: { consent: context.telemetryConsent, prompting: context.telemetryConsent === 'undecided' },
    },
    entering(route, signedIn),
  )
  return {
    model: entered.model,
    commands: [
      ReadSession(),
      ReadTimeZone(),
      ...(AppRoute.guards.BoardCollage(route)
        ? [ReplaceInternal({ href: boardRouter({ boardId: route.boardId }) })]
        : []),
      ...(page.commands ?? []),
      ...(entered.commands ?? []),
    ],
  }
}

// UPDATE

const foldTodayOut = Today.OutMessage.match<Step>({ RequestedPieces: () => revisitPieces })

/** The address changed in the page: its tab opens with what the app has, refreshed behind; any other page loads. */
const changedUrl = (model: Model, url: Url): UpdateReturn => {
  const route = routeFromUrl(url)
  const sameBoard = NavigationState.sameBoardArrival(model, route)
  if (Option.isSome(sameBoard)) return sameBoard.value
  if (Option.isNone(tabOf(route))) return { model, commands: [Navigate({ href: urlToString(url) })] }
  const moved = NavigationState.restoreBrowsing(model, route, url.hash)
  if (AppRoute.guards.Ask(route) && AppRoute.guards.Ask(model.route))
    return Update.combine<Model, Message, Services>(moved, [
      Update.foldChildStep({ update: Ask.changedQuery(route.q), ...at(lenses.ask) }),
      (stepModel) => ({ model: stepModel, commands: Option.isSome(url.hash) ? arrive(url.hash) : [] }),
    ])
  if (isSameTab(model.route, route))
    return Option.isSome(url.hash) ? { model: moved, commands: arrive(url.hash) } : { model: moved }
  return Update.combine<Model, Message, Services>(moved, [
    Update.foldChildStep({ update: Ask.leave, ...at(lenses.ask) }),
    ...entering(route, true),
    (stepModel) => ({ model: stepModel, commands: arrive(url.hash) }),
  ])
}

/** Where a signed-in visitor belongs: sign-in hands over to the page it was asked from (a Follow or a Save on a public
 * page), else to the account, or to the assistant's authorization. */
const afterSignIn =
  (route: AppRoute): Step =>
  (model) =>
    Match.value(route).pipe(
      Match.withReturnType<UpdateReturn>(),
      Match.tag('Login', ({ next }) => ({ model, commands: [returnAfterSignIn(next)] })),
      Match.tag('LoginForConnection', () => ({ model, commands: [Navigate({ href: connectionAuthorizePath })] })),
      Match.tag('Home', () =>
        model.context.hasSessionCookie === true
          ? { model }
          : Update.combine<Model, Message, Services>(model, entering(route, true)),
      ),
      Match.orElse(() => ({ model })),
    )

/** Pages that need a session send a signed-out visitor to sign in. */
const afterSignOut = (route: AppRoute) =>
  routeMeta(route).session === 'required' ? [Navigate({ href: signInHref })] : []

/** Sign out of the session the page holds. */
const requestSignOut = (model: Model): UpdateReturn => {
  const { session } = model
  if (!Session.guards.SignedIn(session)) return { model }
  return {
    model: modifyFields(model, { session: () => Session.SigningOut({ claims: session.claims }) }),
    commands: [SignOut()],
  }
}

const foldLogin = Update.foldChild({
  update: Login.update,
  ...at(lenses.login),
  foldOutMessage: Login.OutMessage.match<Step>({
    SignedIn:
      ({ claims }) =>
      (stepModel) =>
        afterSignIn(stepModel.route)(modifyFields(stepModel, { session: () => Session.SignedIn({ claims }) })),
  }),
})

const foldAccount = Update.foldChild({
  update: Account.update,
  ...at(lenses.account),
  foldOutMessage: Account.OutMessage.match<Step>({
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
  ...at(lenses.wardrobe),
  foldOutMessage: Wardrobe.OutMessage.match<Step>({
    RequestedPieces: () => revisitPieces,
    ChangedBrowse:
      ({ query }) =>
      (model) => ({ model, commands: [ReplaceInternal({ href: wardrobeRouter(query) })] }),
  }),
})

const foldPiece = Update.foldChild({
  update: Piece.update,
  ...at(lenses.piece),
  foldOutMessage: Piece.OutMessage.match<Step>({
    DeletedPiece: () => NavigationState.returnFromPiece,
    RequestedBoards: () => revisitBoards,
  }),
})

/** A profile saved in the editor is who the masthead shows from then on. */
const foldProfile = Update.foldChild({
  update: ProfileEditor.update,
  ...at(lenses.profile),
  foldOutMessage: ProfileEditor.OutMessage.match<Step>({
    SavedProfile:
      ({ profile }) =>
      (stepModel) => ({ model: modifyFields(stepModel, { you: () => youOf(profile.name, profile.tone) }) }),
  }),
})

const foldToday = Update.foldChild({ update: Today.update, ...at(lenses.today), foldOutMessage: foldTodayOut })

const foldAsk = Update.foldChild({
  update: Ask.update,
  ...at(lenses.ask),
  foldOutMessage: Ask.OutMessage.match<Step>({
    RequestedPieces: () => revisitPieces,
    RequestedNewBoard: ({ defaultName }) => startBoard(defaultName),
  }),
})

const foldAddPieces = Update.foldChild({
  update: AddPieces.update,
  ...at(lenses.addPieces),
  foldOutMessage: AddPiecesMessage.OutMessage.match<Step>({
    FinishedSending: () => NavigationState.navigateTo(reviewRouter({})),
  }),
})

const foldReview = Update.foldChild({
  update: Review.update,
  ...at(lenses.review),
  foldOutMessage: Review.OutMessage.match<Step>({
    AddedPieces: () => NavigationState.returnFromReview,
  }),
})

const foldLook = Update.foldChild({
  update: Look.update,
  ...at(lenses.look),
  foldOutMessage: Look.OutMessage.match<Step>({
    DeletedLook: () => NavigationState.navigateTo(looksRouter({})),
    RequestedBoards: () => revisitBoards,
  }),
})

const foldPhoto = Update.foldChild({
  update: Photo.update,
  ...at(lenses.photo),
  foldOutMessage: Photo.OutMessage.match<Step>({
    DeletedPhoto: () => NavigationState.navigateTo(photosRouter({})),
    RequestedBoards: () => revisitBoards,
  }),
})

const foldPages = {
  boards: Update.foldChild({ update: Boards.update, ...foldBoards }),
  board: Update.foldChild({ update: Board.update, ...at(lenses.board) }),
  looks: Update.foldChild({ update: Looks.update, ...at(lenses.looks) }),
  photos: Update.foldChild({ update: Photos.update, ...at(lenses.photos) }),
  stylist: Update.foldChild({ update: Stylist.update, ...at(lenses.stylist) }),
  visit: Update.foldChild({ update: Visit.update, ...at(lenses.visit) }),
  explore: Update.foldChild({ update: Visit.update, ...at(lenses.explore) }),
  data: Update.foldChild({ update: ServerData.update, ...data }),
}

/** The landing's Try again, through Explore's own step. */
const retryLanding = Update.foldChildStep({ update: Visit.retry, ...at(lenses.explore) })

// SUBSCRIPTION

/** The pages that show the pieces, which are asked for again while one is settling. */
const showsPieces = (model: Model) =>
  Match.value(model.route).pipe(
    Match.tag('Wardrobe', 'Ask', 'Board', 'BoardCollage', 'Photo', () => true),
    Match.tag('Home', () => hasSession(model)),
    Match.orElse(() => false),
  )

/** Ongoing work the open page asks for: each runs only while its page is open. */
export const subscriptions = Subscription.aggregate(
  Subscription.lift(AddPiecesSubscription.subscriptions)<Model, Message>(at(lenses.addPieces)),
  Subscription.lift(ServerData.subscriptions)<Model, Message>({ ...data, when: showsPieces }),
  // Tab pages keep their Model while another tab shows, so My Gallery's poll also waits for its own route.
  Subscription.lift(Photos.subscriptions)<Model, Message>({
    ...at(lenses.photos),
    when: (model) => AppRoute.guards.Photos(model.route),
  }),
  Subscription.lift(Photo.subscriptions)<Model, Message>(at(lenses.photo)),
  Subscription.lift(Piece.subscriptions)<Model, Message>(at(lenses.piece)),
  Subscription.lift(Review.subscriptions)<Model, Message>(at(lenses.review)),
  Subscription.lift(Stylist.subscriptions)<Model, Message>(at(lenses.stylist)),
  // A board's page listens for coming back into view; its collage editor also for hands, keys, pasted pictures and
  // dropped files.
  Subscription.lift(BoardSubscription.pageSubscriptions)<Model, Message>(at(lenses.board)),
  Subscription.lift(BoardSubscription.subscriptions)<Model, Message>({
    ...at(lenses.board),
    when: (model) =>
      Option.exists(
        lenses.board.read(model.page),
        (board) =>
          Option.isSome(ownBoard(board.board)) &&
          !sheetShown(board.settings) &&
          !sheetShown(board.picker) &&
          !sheetShown(board.piecePicker) &&
          !sheetShown(board.make.sheet) &&
          !PinWork.guards.Sending(board.pinWork),
      ),
  }),
)

/** The session as read: signed out, or signed in, when sign-in hands over to another page (which reads its own) and
 * any other page shows you in the masthead, blank until the profile is read. */
const receivedSession = (model: Model, claims: AccountClaims | null): UpdateReturn => {
  if (claims === null)
    return {
      model: modifyFields(model, { session: () => Session.SignedOut(), you: () => You.Unknown() }),
      commands: afterSignOut(model.route),
    }
  const signedIn = afterSignIn(model.route)(modifyFields(model, { session: () => Session.SignedIn({ claims }) }))
  const leaves = AppRoute.guards.Login(model.route) || AppRoute.guards.LoginForConnection(model.route)
  return leaves
    ? signedIn
    : {
        model: modifyFields(signedIn.model, { you: () => You.Reading() }),
        commands: [...(signedIn.commands ?? []), ReadYou()],
      }
}

const settings = (model: Model) => ({
  SelectedLocale: ({ value }: { readonly value: string }): UpdateReturn => {
    const locale = parseLocale(value)
    if (locale === undefined || LocaleSave.guards.Saving(model.localeSave)) return { model }
    return {
      model: modifyFields(model, { localeSave: () => LocaleSave.Saving({ locale }) }),
      commands: [SaveLocale({ locale })],
    }
  },
  SucceededReadTimeZone: ({ timeZone }: { readonly timeZone: string }): UpdateReturn => ({
    model: modifyFields(model, { context: (context) => modifyFields(context, { timeZone: () => timeZone }) }),
  }),
  SucceededSaveLocale: ({ locale }: { readonly locale: Locale }): UpdateReturn => ({
    model: modifyFields(model, {
      context: (context) => modifyFields(context, { locale: () => locale }),
      localeSave: () => LocaleSave.Saved(),
    }),
  }),
  FailedSaveLocale: (): UpdateReturn => ({ model: modifyFields(model, { localeSave: () => LocaleSave.Failed() }) }),
  ChoseTelemetryConsent: ({ granted }: { readonly granted: boolean }): UpdateReturn => ({
    model: modifyFields(model, { telemetry: (telemetry) => modifyFields(telemetry, { prompting: () => false }) }),
    commands: [RecordTelemetryConsent({ granted })],
  }),
  RecordedTelemetryConsent: ({ granted }: { readonly granted: boolean }): UpdateReturn => {
    const consent: TelemetryConsent = granted ? 'granted' : 'denied'
    return { model: modifyFields(model, { telemetry: () => ({ consent, prompting: false }) }) }
  },
  OpenedTelemetrySettings: (): UpdateReturn => ({
    model: modifyFields(model, { telemetry: (telemetry) => modifyFields(telemetry, { prompting: () => true }) }),
  }),
})

const sessionUpdates = (model: Model) => ({
  ReceivedSession: ({ claims }: { readonly claims: AccountClaims | null }) => receivedSession(model, claims),
  SucceededReadYou: ({ name, tone }: { readonly name: string; readonly tone: Tone }): UpdateReturn => ({
    model: modifyFields(model, { you: () => youOf(name, tone) }),
  }),
  FailedReadYou: (): UpdateReturn => ({ model: modifyFields(model, { you: () => You.Unknown() }) }),
  FailedReadSession: (): UpdateReturn => ({ model: modifyFields(model, { session: () => Session.Unavailable() }) }),
  RequestedSession: (): UpdateReturn => ({
    model: modifyFields(model, { session: () => Session.Checking() }),
    commands: [ReadSession()],
  }),
  SucceededSignOut: (): UpdateReturn => ({
    model: modifyFields(model, { session: () => Session.SignedOut(), you: () => You.Unknown() }),
    commands: afterSignOut(model.route),
  }),
  FailedSignOut: (): UpdateReturn => ({ model: modifyFields(model, { session: () => Session.Unavailable() }) }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ...settings(model),
    ...sessionUpdates(model),
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
    GotStylistMessage: (got) => foldPages.stylist(model, got.message),
    GotLooksMessage: (got) => foldPages.looks(model, got.message),
    GotPhotosMessage: (got) => foldPages.photos(model, got.message),
    GotPhotoMessage: (got) => foldPhoto(model, got.message),
    GotLookMessage: (got) => foldLook(model, got.message),
    GotProfileMessage: (got) => foldProfile(model, got.message),
    GotTodayMessage: (got) => foldToday(model, got.message),
    GotAskMessage: (got) => foldAsk(model, got.message),
    GotBoardsMessage: (got) => foldPages.boards(model, got.message),
    GotBoardMessage: (got) => foldPages.board(model, got.message),
    GotVisitMessage: (got) => foldPages.visit(model, got.message),
    GotExploreMessage: (got) => foldPages.explore(model, got.message),
    GotServerDataMessage: (got) =>
      Update.combine<Model, Message, Services>(model, [
        (stepModel) => foldPages.data(stepModel, got.message),
        (stepModel) =>
          Predicate.isTagged(got.message, 'SucceededListPieces')
            ? NavigationState.restoreWardrobePosition(stepModel)
            : { model: stepModel },
      ]),
    ClickedRetryLanding: () => retryLanding(model),
  })
