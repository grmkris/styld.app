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
import { catalogVersion } from '@styld/i18n'
import { Locale, localeEndpoint, parseLocale } from './Locale.ts'
import * as Login from './page/Login.ts'
import { AppRoute, accountRouter, connectionAuthorizePath, loginRouter, routeFromPathname } from './route.ts'
import { TelemetryConsent, TelemetryConsentControl } from './TelemetryConsent.ts'

// MODEL

export const Flags = Schema.Struct({
  locale: Locale,
  catalogVersion: Schema.Literal(catalogVersion),
  timeZone: Schema.String,
  referenceTime: Schema.Number,
  pathname: Schema.String,
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
  RequestedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  CompletedNavigate: {},
  GotLoginMessage: { message: Login.Message },
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

type Services = HttpClient.HttpClient | BrowserAuth | Login.EmailSignIn | TelemetryConsentControl
type UpdateReturn = Update.Return<Model, Message, Services>

// INIT

export const init = (context: Flags): UpdateReturn => ({
  model: {
    context,
    route: routeFromPathname(context.pathname),
    localeSave: LocaleSave.Saved(),
    session: Session.Checking(),
    login: Login.init(),
    telemetry: { consent: context.telemetryConsent, prompting: context.telemetryConsent === 'undecided' },
  },
  commands: [ReadSession()],
})

// UPDATE

/** Where a signed-in visitor belongs: sign-in pages hand over to the account, or back to the
 * assistant's pending authorization. */
const afterSignIn = (route: AppRoute) =>
  AppRoute.match(route, {
    Login: () => [Navigate({ href: accountRouter({}) })],
    LoginForConnection: () => [Navigate({ href: connectionAuthorizePath })],
    Home: () => [],
    Account: () => [],
    NotFound: () => [],
  })

/** Pages that need a session send a signed-out visitor to sign in. */
const afterSignOut = (route: AppRoute) => (AppRoute.guards.Account(route) ? [Navigate({ href: loginRouter({}) })] : [])

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
    RequestedSignOut: () => {
      const { session } = model
      if (!Session.guards.SignedIn(session)) return { model }
      return {
        model: modifyFields(model, { session: () => Session.SigningOut({ claims: session.claims }) }),
        commands: [SignOut()],
      }
    },
    SucceededSignOut: () => ({
      model: modifyFields(model, { session: () => Session.SignedOut() }),
      commands: afterSignOut(model.route),
    }),
    FailedSignOut: () => ({ model: modifyFields(model, { session: () => Session.Unavailable() }) }),
    CompletedNavigate: () => ({ model }),
    GotLoginMessage: (got) => foldLogin(model, got.message),
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
