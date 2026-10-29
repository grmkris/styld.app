import { Effect, Option, Schema } from 'effect'
import { BrowserAuth } from '@styld/auth/client'
import { AccountClaims } from '@styld/auth/config'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { load } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { catalogVersion, loadCatalog } from '@styld/i18n'
import { Locale, localeEndpoint, parseLocale } from './Locale.ts'
import * as Crypto from 'effect/Crypto'
import * as AddPiece from './page/AddPiece.ts'
import * as Account from './page/Account.ts'
import * as Login from './page/Login.ts'
import * as Piece from './page/Piece.ts'
import * as Wardrobe from './page/Wardrobe.ts'
import {
  AppRoute,
  accountRouter,
  connectionAuthorizePath,
  homeRouter,
  loginRouter,
  needsSession,
  pieceRouter,
  routeFromPathname,
  wardrobeRouter,
} from './route.ts'
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
  addPiece: AddPiece.Model,
  account: Account.Model,
  telemetry: Schema.Struct({ consent: TelemetryConsent, prompting: Schema.Boolean }),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedLocale: { value: Schema.String },
  SucceededSaveLocale: { locale: Locale },
  FailedSaveLocale: {},
  ReceivedSession: { claims: Schema.NullOr(AccountClaims) },
  FailedReadSession: {},
  RequestedSession: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  CompletedNavigate: {},
  GotLoginMessage: { message: Login.Message },
  GotAccountMessage: { message: Account.Message },
  GotWardrobeMessage: { message: Wardrobe.Message },
  GotPieceMessage: { message: Piece.Message },
  GotAddPieceMessage: { message: AddPiece.Message },
  ChoseTelemetryConsent: { granted: Schema.Boolean },
  RecordedTelemetryConsent: { granted: Schema.Boolean },
  OpenedTelemetrySettings: {},
})
export type Message = typeof Message.Type

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

/** A full page load: the next page renders on the server for the new session.
 * @internal Exported for its tests. */
export const Navigate = Command.define('Navigate', {
  args: { href: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedNavigate())),
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

type Services =
  | HttpClient.HttpClient
  | BrowserAuth
  | Login.EmailSignIn
  | TelemetryConsentControl
  | StyldClient
  | Crypto.Crypto
type UpdateReturn = Update.Return<Model, Message, Services>

// INIT

/** The Commands that open the page a route shows. */
const pageCommands = (route: AppRoute, piece: Piece.Model) =>
  AppRoute.match(route, {
    Wardrobe: () => Command.mapMessages(Wardrobe.load(), (message) => Message.GotWardrobeMessage({ message })),
    Piece: () => Command.mapMessages(Piece.load(piece), (message) => Message.GotPieceMessage({ message })),
    AddPiece: () => [],
    Home: () => [],
    Login: () => [],
    LoginForConnection: () => [],
    Account: () => [],
    NotFound: () => [],
  })

export const init = (context: Flags): UpdateReturn => {
  const route = routeFromPathname(context.pathname)
  const piece = Piece.init(AppRoute.guards.Piece(route) ? route.pieceId : '')
  return {
    model: {
      context,
      route,
      localeSave: LocaleSave.Saved(),
      session: Session.Checking(),
      login: Login.init(),
      wardrobe: Wardrobe.init(),
      piece,
      addPiece: AddPiece.init(),
      account: Account.init(),
      telemetry: { consent: context.telemetryConsent, prompting: context.telemetryConsent === 'undecided' },
    },
    commands: [ReadSession(), ...pageCommands(route, piece)],
  }
}

// UPDATE

/** Where a signed-in visitor belongs: sign-in pages hand over to the account, or back to the
 * assistant's pending authorization. */
const afterSignIn = (route: AppRoute) =>
  AppRoute.match(route, {
    Login: () => [Navigate({ href: accountRouter({}) })],
    LoginForConnection: () => [Navigate({ href: connectionAuthorizePath })],
    Home: () => [],
    Account: () => [],
    Wardrobe: () => [],
    AddPiece: () => [],
    Piece: () => [],
    NotFound: () => [],
  })

/** Pages that need a session send a signed-out visitor to sign in. */
const afterSignOut = (route: AppRoute) => (needsSession(route) ? [Navigate({ href: loginRouter({}) })] : [])

const foldLoginOutMessage = Login.OutMessage.match<Update.Step<Model, Message, Services>>({
  SignedIn:
    ({ claims }) =>
    (stepModel) => ({
      model: modifyFields(stepModel, { session: () => Session.SignedIn({ claims }) }),
      commands: afterSignIn(stepModel.route),
    }),
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

const foldAddPiece = Update.foldChild({
  update: AddPiece.update,
  read: (model: Model) => Option.some(model.addPiece),
  write: (model: Model, addPiece: AddPiece.Model) => modifyFields(model, { addPiece: () => addPiece }),
  toParentMessage: (message: AddPiece.Message) => Message.GotAddPieceMessage({ message }),
  foldOutMessage: AddPiece.OutMessage.match<Update.Step<Model, Message, Services>>({
    AddedPiece:
      ({ pieceId }) =>
      (stepModel) => ({ model: stepModel, commands: [Navigate({ href: pieceRouter({ pieceId }) })] }),
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
        : {
            model: modifyFields(model, { session: () => Session.SignedIn({ claims }) }),
            commands: afterSignIn(model.route),
          },
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
    GotLoginMessage: (got) => foldLogin(model, got.message),
    GotAccountMessage: (got) => foldAccount(model, got.message),
    GotWardrobeMessage: (got) => foldWardrobe(model, got.message),
    GotPieceMessage: (got) => foldPiece(model, got.message),
    GotAddPieceMessage: (got) => foldAddPiece(model, got.message),
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
