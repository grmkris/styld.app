import { Handle, PieceId, PublicPiecePage, PublicProfile } from '@styld/protocol'
import { Effect, Predicate, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// What anyone may see of a person: their published profile at `/@handle`, and a piece of theirs on its own page.
// Both are read signed out; anything private, unpublished or held back by Styld's check reads as not there.

// MODEL

/** Whose page this is: a person by handle, or one of their pieces. */
export const Target = defineTaggedUnion({ Person: { handle: Schema.String }, Piece: { pieceId: Schema.String } })
export type Target = typeof Target.Type

/** The profile's tabs; Pieces shows only when its owner shows the wardrobe. */
export const PersonTab = Schema.Literals(['boards', 'looks', 'pieces'])
export type PersonTab = typeof PersonTab.Type

export const Shown = defineTaggedUnion({
  Loading: {},
  Missing: {},
  Failed: {},
  Person: { profile: PublicProfile },
  Piece: { page: PublicPiecePage },
})
export type Shown = typeof Shown.Type

export const Model = Schema.Struct({ target: Target, shown: Shown, tab: PersonTab })
export type Model = typeof Model.Type

export const init = (target: Target): Model => ({ target, shown: Shown.Loading(), tab: 'boards' })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadPerson: { profile: PublicProfile },
  SucceededLoadPublicPiece: { page: PublicPiecePage },
  FailedLoadVisit: { missing: Schema.Boolean },
  ClickedRetry: {},
  ChoseTab: { tab: PersonTab },
})
export type Message = typeof Message.Type

// COMMAND

/** Not there for others: missing, private, unpublished or held back, or an address that is no handle or id. */
const isMissing = (error: unknown) =>
  Predicate.isTagged(error, 'PublicNotFound') || Predicate.isTagged(error, 'SchemaError')

const LoadPerson = Command.define('LoadPerson', {
  args: { handle: Schema.String },
  messages: [Message.SucceededLoadPerson, Message.FailedLoadVisit],
  execute: ({ handle }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const profile = yield* api.public.profile({
        params: { handle: yield* Schema.decodeUnknownEffect(Handle)(handle.toLowerCase()) },
      })
      return Message.SucceededLoadPerson({ profile })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadVisit({ missing: true }))),
      Effect.orElseSucceed(() => Message.FailedLoadVisit({ missing: false })),
    ),
})

const LoadPublicPiece = Command.define('LoadPublicPiece', {
  args: { pieceId: Schema.String },
  messages: [Message.SucceededLoadPublicPiece, Message.FailedLoadVisit],
  execute: ({ pieceId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const page = yield* api.public.piece({ params: { pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) } })
      return Message.SucceededLoadPublicPiece({ page })
    }).pipe(
      Effect.catchIf(isMissing, () => Effect.succeed(Message.FailedLoadVisit({ missing: true }))),
      Effect.orElseSucceed(() => Message.FailedLoadVisit({ missing: false })),
    ),
})

const loadTarget = (target: Target): Command.Command<Message, never, StyldClient> =>
  Target.match(target, {
    Person: ({ handle }) => LoadPerson({ handle }),
    Piece: ({ pieceId }) => LoadPublicPiece({ pieceId }),
  })

/** The Commands that open the page. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, StyldClient>> => [
  loadTarget(model.target),
]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadPerson: ({ profile }) => ({ model: modifyFields(model, { shown: () => Shown.Person({ profile }) }) }),
    SucceededLoadPublicPiece: ({ page }) => ({ model: modifyFields(model, { shown: () => Shown.Piece({ page }) }) }),
    FailedLoadVisit: ({ missing }) => ({
      model: modifyFields(model, { shown: () => (missing ? Shown.Missing() : Shown.Failed()) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { shown: () => Shown.Loading() }),
      commands: [loadTarget(model.target)],
    }),
    ChoseTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab }) }),
  })
