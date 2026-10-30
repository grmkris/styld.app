import { Handle, Profile, Tone } from '@styld/protocol'
import { Effect, Match, Option, Predicate, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// The person's public profile, edited: a handle, a name, a city, a bio, an avatar tone and whether the wardrobe shows,
// then published or taken down.

// MODEL

export const Load = defineTaggedUnion({ Loading: {}, Failed: {}, Ready: { profile: Profile } })
export type Load = typeof Load.Type

/** What the form holds, as typed. */
export const Draft = Schema.Struct({
  handle: Schema.String,
  name: Schema.String,
  city: Schema.String,
  bio: Schema.String,
  tone: Tone,
  wardrobeShown: Schema.Boolean,
})
export type Draft = typeof Draft.Type

/** Why a save did not land. */
const SaveProblem = Schema.Literals(['taken', 'reserved', 'invalid', 'other'])
type SaveProblem = typeof SaveProblem.Type

export const Saving = defineTaggedUnion({ Idle: {}, Saving: {}, Saved: {}, Failed: { problem: SaveProblem } })
export type Saving = typeof Saving.Type

export const Publishing = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { needsHandle: Schema.Boolean } })
export type Publishing = typeof Publishing.Type

export const Model = Schema.Struct({ load: Load, draft: Draft, saving: Saving, publishing: Publishing })
export type Model = typeof Model.Type

const emptyDraft: Draft = { handle: '', name: '', city: '', bio: '', tone: 'sand', wardrobeShown: true }

export const init = (): Model => ({
  load: Load.Loading(),
  draft: emptyDraft,
  saving: Saving.Idle(),
  publishing: Publishing.Idle(),
})

const draftOf = (profile: Profile): Draft => ({
  handle: profile.handle ?? '',
  name: profile.name,
  city: profile.city ?? '',
  bio: profile.bio ?? '',
  tone: profile.tone,
  wardrobeShown: profile.wardrobeShown,
})

// MESSAGE

const Field = Schema.Literals(['handle', 'name', 'city', 'bio'])
type Field = typeof Field.Type

export const Message = defineMessageUnion({
  SucceededLoadProfile: { profile: Profile },
  FailedLoadProfile: {},
  ClickedRetry: {},
  UpdatedField: { field: Field, value: Schema.String },
  ChoseTone: { tone: Tone },
  ToggledWardrobeShown: { shown: Schema.Boolean },
  SubmittedProfile: {},
  SucceededSaveProfile: { profile: Profile },
  FailedSaveProfile: { problem: SaveProblem },
  ClickedPublish: { published: Schema.Boolean },
  SucceededPublishProfile: { profile: Profile },
  FailedPublishProfile: { needsHandle: Schema.Boolean },
})
export type Message = typeof Message.Type

// COMMAND

const LoadProfile = Command.define('LoadProfile', {
  messages: [Message.SucceededLoadProfile, Message.FailedLoadProfile],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededLoadProfile({ profile: yield* api.profile.getProfile() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadProfile())),
})

const blankAsNull = (value: string) => (value.trim().length === 0 ? null : value.trim())

/** @internal Exported for its tests. */
export const SaveProfile = Command.define('SaveProfile', {
  args: { draft: Draft },
  messages: [Message.SucceededSaveProfile, Message.FailedSaveProfile],
  execute: ({ draft }) =>
    Effect.gen(function* () {
      const handle = Schema.decodeUnknownOption(Handle)(draft.handle.trim().replace(/^@/, '').toLowerCase())
      if (draft.handle.trim().length > 0 && Option.isNone(handle))
        return Message.FailedSaveProfile({ problem: 'invalid' })
      const api = yield* (yield* StyldClient).api
      const profile = yield* api.profile.updateProfile({
        payload: {
          ...(Option.isSome(handle) ? { handle: handle.value } : {}),
          name: draft.name.trim(),
          city: blankAsNull(draft.city),
          bio: blankAsNull(draft.bio),
          tone: draft.tone,
          wardrobeShown: draft.wardrobeShown,
        },
      })
      return Message.SucceededSaveProfile({ profile })
    }).pipe(
      Effect.catchIf(
        (error) => Predicate.isTagged(error, 'HandleTaken'),
        () => Effect.succeed(Message.FailedSaveProfile({ problem: 'taken' })),
      ),
      Effect.catchIf(
        (error) => Predicate.isTagged(error, 'HandleReserved'),
        () => Effect.succeed(Message.FailedSaveProfile({ problem: 'reserved' })),
      ),
      Effect.catchIf(
        (error) => Predicate.isTagged(error, 'SchemaError'),
        () => Effect.succeed(Message.FailedSaveProfile({ problem: 'invalid' })),
      ),
      Effect.orElseSucceed(() => Message.FailedSaveProfile({ problem: 'other' })),
    ),
})

/** @internal Exported for its tests. */
export const PublishProfile = Command.define('PublishProfile', {
  args: { published: Schema.Boolean },
  messages: [Message.SucceededPublishProfile, Message.FailedPublishProfile],
  execute: ({ published }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      return Message.SucceededPublishProfile({ profile: yield* api.profile.publishProfile({ payload: { published } }) })
    }).pipe(
      Effect.catchIf(
        (error) => Predicate.isTagged(error, 'ProfileNeedsHandle'),
        () => Effect.succeed(Message.FailedPublishProfile({ needsHandle: true })),
      ),
      Effect.orElseSucceed(() => Message.FailedPublishProfile({ needsHandle: false })),
    ),
})

/** The Commands that open the page. */
export const load = () => [LoadProfile()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

/** A field of the draft as typed. */
const typed =
  (field: Field, value: string) =>
  (draft: Draft): Draft =>
    Match.value(field).pipe(
      Match.when('handle', () => modifyFields(draft, { handle: () => value })),
      Match.when('name', () => modifyFields(draft, { name: () => value })),
      Match.when('city', () => modifyFields(draft, { city: () => value })),
      Match.when('bio', () => modifyFields(draft, { bio: () => value })),
      Match.exhaustive,
    )

const loaded = (model: Model, profile: Profile): UpdateReturn => ({
  model: modifyFields(model, { load: () => Load.Ready({ profile }), draft: () => draftOf(profile) }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadProfile: ({ profile }) => loaded(model, profile),
    FailedLoadProfile: () => ({ model: modifyFields(model, { load: () => Load.Failed() }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { load: () => Load.Loading() }), commands: [LoadProfile()] }),
    UpdatedField: ({ field, value }) => ({
      model: modifyFields(model, { draft: typed(field, value), saving: () => Saving.Idle() }),
    }),
    ChoseTone: ({ tone }) => ({
      model: modifyFields(model, { draft: (draft) => modifyFields(draft, { tone: () => tone }) }),
    }),
    ToggledWardrobeShown: ({ shown }) => ({
      model: modifyFields(model, { draft: (draft) => modifyFields(draft, { wardrobeShown: () => shown }) }),
    }),
    SubmittedProfile: () =>
      Saving.guards.Saving(model.saving)
        ? { model }
        : {
            model: modifyFields(model, { saving: () => Saving.Saving() }),
            commands: [SaveProfile({ draft: model.draft })],
          },
    SucceededSaveProfile: ({ profile }) => {
      const next = loaded(model, profile)
      return { model: modifyFields(next.model, { saving: () => Saving.Saved() }) }
    },
    FailedSaveProfile: ({ problem }) => ({ model: modifyFields(model, { saving: () => Saving.Failed({ problem }) }) }),
    ClickedPublish: ({ published }) =>
      Publishing.guards.Sending(model.publishing)
        ? { model }
        : {
            model: modifyFields(model, { publishing: () => Publishing.Sending() }),
            commands: [PublishProfile({ published })],
          },
    SucceededPublishProfile: ({ profile }) => ({
      model: modifyFields(model, { load: () => Load.Ready({ profile }), publishing: () => Publishing.Idle() }),
    }),
    FailedPublishProfile: ({ needsHandle }) => ({
      model: modifyFields(model, { publishing: () => Publishing.Failed({ needsHandle }) }),
    }),
  })
