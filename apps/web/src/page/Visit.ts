import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Handle, PieceId, PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Effect, Option, Predicate, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { LoadError } from '../ServerData.ts'
import { StyldClient } from '../StyldClient.ts'
import * as People from './People.ts'
import * as Share from './Share.ts'

// What anyone may see of a person: their published profile at `/@handle`, and a piece of theirs on its own page.
// Both are read signed out; anything private, unpublished or held back by Styld's check reads as not there.

// MODEL

/** Whose page this is: a person by handle, or one of their pieces. */
export const Target = defineTaggedUnion({
  Person: { handle: Schema.String },
  Piece: { pieceId: Schema.String },
})
export type Target = typeof Target.Type

/** The profile's tabs; Pieces shows only when its owner shows the wardrobe. */
export const PersonTab = Schema.Literals(['boards', 'looks'])
export type PersonTab = typeof PersonTab.Type

/** What a public page shows once read. */
export const VisitShown = defineTaggedUnion({
  Person: { profile: PublicProfile },
  Piece: { page: PublicPiecePage },
})
export type VisitShown = typeof VisitShown.Type

/** The page as last read; a failure keeps what was shown, and one for a page that is not there for others is
 * NotFound. */
export const ShownData = AsyncData.Schema(VisitShown, LoadError)
export type ShownData = typeof ShownData.schema.Type

export const Model = Schema.Struct({
  target: Target,
  shown: ShownData.schema,
  tab: PersonTab,
  people: People.Model,
  sharing: Share.Model,
  /** On a piece's page, the board or look it was opened from, where Back returns: a piece is public only through
   * one (owner, 2026-10-31), and its owner's profile does not list pieces. */
  cameFrom: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

/** A page for a visitor; `atFollow` when it opened at `#follow`, where sign-in returns a Follow pressed signed out. */
export const init = (target: Target, atFollow = false): Model => ({
  target,
  shown: AsyncData.Loading(),
  tab: 'boards',
  sharing: Share.init,
  cameFrom: Option.none(),
  people: People.init(
    Target.match(target, {
      Person: ({ handle }) => People.Subject.Person({ handle }),
      Piece: ({ pieceId }) => People.Subject.Piece({ pieceId }),
    }),
    atFollow,
  ),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadPerson: { profile: PublicProfile },
  FailedLoadPerson: { error: LoadError },
  SucceededLoadPublicPiece: { page: PublicPiecePage },
  FailedLoadPublicPiece: { error: LoadError },
  SucceededReadCameFrom: { path: Schema.Option(Schema.String) },
  ClickedRetry: {},
  ChoseTab: { tab: PersonTab },
  GotPeopleMessage: { message: People.Message },
  GotShareMessage: { message: Share.Message },
})
export type Message = typeof Message.Type

// COMMAND

/** Not there for others: missing, private, unpublished or held back, or an address that is no handle or id. */
const isMissing = (error: unknown) => Predicate.isTagged(error, 'NotFound') || Predicate.isTagged(error, 'SchemaError')

const LoadPerson = Command.define('LoadPerson', {
  args: { handle: Schema.String },
  messages: [Message.SucceededLoadPerson, Message.FailedLoadPerson],
  execute: ({ handle }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const profile = yield* api.public.profile({
        params: { handle: yield* Schema.decodeUnknownEffect(Handle)(handle.toLowerCase()) },
      })
      return Message.SucceededLoadPerson({ profile })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadPerson({ error: 'NotFound' }))),
      Effect.orElseSucceed(() => Message.FailedLoadPerson({ error: 'Unavailable' })),
    ),
})

const LoadPublicPiece = Command.define('LoadPublicPiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededLoadPublicPiece, Message.FailedLoadPublicPiece],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const page = yield* api.public.piece({ params: { pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) } })
      return Message.SucceededLoadPublicPiece({ page })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadPublicPiece({ error: 'NotFound' }))),
      Effect.orElseSucceed(() => Message.FailedLoadPublicPiece({ error: 'Unavailable' })),
    ),
})

/** The pages of this site a public piece is opened from: a public board or a look, Home's feed and Boards' Saved. */
const boardOrLook = /^\/(?:(?:boards\/bd_|looks\/lk_)[\w-]{22}|boards)?$/

/** The board or look page a piece was opened from, from where the page was loaded: a same-origin referrer naming
 * one, nothing for a shared link or any other page.
 */
export const cameFromOf = (referrer: string, origin: string): Option.Option<string> =>
  Option.flatMap(Option.liftThrowable(() => new URL(referrer))(), (url) =>
    url.origin === origin && boardOrLook.test(url.pathname) ? Option.some(url.pathname) : Option.none(),
  )

/** Where a piece's page was opened from, read in the browser once it runs. */
const ReadCameFrom = Command.define('ReadCameFrom', {
  messages: [Message.SucceededReadCameFrom],
  execute: Effect.sync(() =>
    Message.SucceededReadCameFrom({ path: cameFromOf(document.referrer, window.location.origin) }),
  ),
})

const loadTarget = (target: Target): Command.Command<Message, never, StyldClient | SecureRandom.SecureRandom> =>
  Target.match(target, {
    Person: ({ handle }) => LoadPerson({ handle }),
    Piece: ({ pieceId }) => LoadPublicPiece({ pieceId }),
  })

/** The Commands that open the page; where the visitor stands with the person is read once the profile is in. */
export const load = (
  model: Model,
): ReadonlyArray<Command.Command<Message, never, StyldClient | SecureRandom.SecureRandom>> => [
  loadTarget(model.target),
  ...(Target.guards.Piece(model.target) ? [ReadCameFrom()] : []),
]

/** What the page is told by the app: whether there is a session as the app knows it now (the cookie's hint until the
 * session is read); only then is there a relation to read. */
export type Context = { readonly signedIn: boolean }

/** Signed in, on someone else's profile: where the visitor stands with them is read. Signed out there is nothing to
 * read, and on one's own profile nobody to follow. */
const withRelation = (model: Model, profile: PublicProfile, { signedIn }: Context): UpdateReturn => {
  if (!signedIn || profile.yours) return { model }
  const read = People.readRelation(model.people)
  return {
    model: modifyFields(model, { people: () => read.model }),
    commands: Command.mapMessages(read.commands ?? [], (message) => Message.GotPeopleMessage({ message })),
  }
}

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | SecureRandom.SecureRandom>

/** The tab a profile opens on: Looks when only looks are public, so a visitor never lands on an empty Boards while
 * the person's looks wait behind the next tab. */
const openingTab = (profile: PublicProfile): PersonTab =>
  profile.boards.length === 0 && profile.looks.length > 0 ? 'looks' : 'boards'

/** The page read again: what it showed stays while it is (a failure keeps it too), a page with nothing yet loads, and
 * a read already on its way is not repeated. */
const readAgain = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.shown), {
    onNone: () => ({ model }),
    onSome: (shown) => ({ model: modifyFields(model, { shown: () => shown }), commands: [loadTarget(model.target)] }),
  })

const foldPeople = People.foldInto<Model, Message>((message) => Message.GotPeopleMessage({ message }))
const foldShare = Share.foldInto<Model, Message>((message) => Message.GotShareMessage({ message }))

/** A read that did not come: the page keeps what it showed and says why. */
const failed = (model: Model, error: LoadError): UpdateReturn => ({
  model: modifyFields(model, { shown: (shown) => AsyncData.settle(shown, Result.fail(error)) }),
})

export const update = (model: Model, message: Message, context: Context): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadPerson: ({ profile }) =>
      withRelation(
        modifyFields(model, {
          shown: () => ShownData.Success({ data: VisitShown.Person({ profile }) }),
          tab: () => openingTab(profile),
        }),
        profile,
        context,
      ),
    SucceededLoadPublicPiece: ({ page }) => ({
      model: modifyFields(model, { shown: () => ShownData.Success({ data: VisitShown.Piece({ page }) }) }),
    }),
    SucceededReadCameFrom: ({ path }) => ({ model: modifyFields(model, { cameFrom: () => path }) }),
    FailedLoadPerson: ({ error }) => failed(model, error),
    FailedLoadPublicPiece: ({ error }) => failed(model, error),
    ClickedRetry: () => readAgain(model),
    ChoseTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab }) }),
    GotPeopleMessage: (got) => foldPeople(model, got.message),
    GotShareMessage: (got) => foldShare(model, got.message),
  })
