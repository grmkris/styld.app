import { Occasion, StyleNoteId, Taste } from '@styld/protocol'
import { Array, Effect, Option, Result, Schema } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import { drawOperationId } from '../OperationIds.ts'

// What Styld knows about you (owner, 4 November 2026: "Styld learns the person"), on the Account page: the occasions
// the person dresses for, which they change here; the notes they asked Styld to remember, each removable; and what
// Styld learned from what they save and wear, read only. Show me has its own section beside it (`ShowMe.ts`).

// MODEL

export const TasteData = AsyncData.Schema(Taste, Schema.Literal('Unavailable'))
export type TasteData = typeof TasteData.schema.Type

/** The occasions on their way, or a choice that did not save. */
export const Choosing = defineTaggedUnion({
  Idle: {},
  Saving: { occasions: Schema.Array(Occasion) },
  Failed: {},
})

/** A note being forgotten, or one that could not be. */
export const Removal = defineTaggedUnion({
  Idle: {},
  Removing: { noteId: StyleNoteId },
  Failed: { noteId: StyleNoteId },
})

export const Model = Schema.Struct({ taste: TasteData.schema, choosing: Choosing, removal: Removal })
export type Model = typeof Model.Type

export const init = (): Model => ({ taste: AsyncData.Idle(), choosing: Choosing.Idle(), removal: Removal.Idle() })

/** The occasions as chosen: those on their way, else those saved. */
export const shownOccasions = (model: Model): ReadonlyArray<Occasion> =>
  Choosing.guards.Saving(model.choosing)
    ? model.choosing.occasions
    : Option.match(AsyncData.getData(model.taste), { onNone: () => [], onSome: ({ occasions }) => occasions })

/** The occasions with one more, or one fewer, kept in the app's order. */
const toggled = (occasions: ReadonlyArray<Occasion>, occasion: Occasion): ReadonlyArray<Occasion> => {
  const chosen = occasions.includes(occasion) ? occasions.filter((each) => each !== occasion) : [...occasions, occasion]
  return Occasion.literals.filter((each) => chosen.includes(each))
}

// MESSAGE

export const Message = defineMessageUnion({
  SucceededReadTaste: { taste: Taste },
  FailedReadTaste: {},
  ClickedRetry: {},
  ClickedOccasion: { occasion: Occasion },
  SucceededSaveOccasions: { taste: Taste },
  FailedSaveOccasions: {},
  ClickedRemoveNote: { noteId: StyleNoteId },
  SucceededRemoveNote: { noteId: StyleNoteId },
  FailedRemoveNote: { noteId: StyleNoteId },
})
export type Message = typeof Message.Type

// COMMAND

export const ReadTaste = Command.define('ReadTaste', {
  messages: [Message.SucceededReadTaste, Message.FailedReadTaste],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededReadTaste({ taste: yield* api.taste.getTaste() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadTaste())),
})

export const SaveOccasions = Command.define('SaveOccasions', {
  args: { occasions: Schema.Array(Occasion) },
  messages: [Message.SucceededSaveOccasions, Message.FailedSaveOccasions],
  execute: ({ occasions }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const taste = yield* api.taste.setOccasions({ payload: { operationId: yield* drawOperationId(), occasions } })
      return Message.SucceededSaveOccasions({ taste })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSaveOccasions())),
})

export const RemoveNote = Command.define('RemoveNote', {
  args: { noteId: StyleNoteId },
  messages: [Message.SucceededRemoveNote, Message.FailedRemoveNote],
  execute: ({ noteId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.taste.deleteStyleNote({ params: { noteId }, payload: { operationId: yield* drawOperationId() } })
      return Message.SucceededRemoveNote({ noteId })
    }).pipe(Effect.orElseSucceed(() => Message.FailedRemoveNote({ noteId }))),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | SecureRandom.SecureRandom>

/** How the Account page holds it: in its `taste`, its Messages wrapped in the page's. */
export const heldBy = <Parent extends { readonly taste: Model }, ParentMessage>(
  toParentMessage: (message: Message) => ParentMessage,
) => ({
  read: (parent: Parent) => Option.some(parent.taste),
  write: (parent: Parent, taste: Model): Parent => ({ ...parent, taste }),
  toParentMessage,
})

/** Opening the Account page: what Styld knows, kept on screen while it is read again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.refresh<Model, Message, Taste, 'Unavailable', StyldClient>({
    read: (current: Model) => Option.some(current.taste),
    revalidate: AsyncData.revalidateOrLoad,
    write: (current: Model, taste: TasteData) => modifyFields(current, { taste: () => taste }),
    load: ReadTaste(),
  })(model)

/** The taste as read, with one note gone. */
const withoutNote = (taste: TasteData, noteId: StyleNoteId): TasteData =>
  Option.match(AsyncData.getData(taste), {
    onNone: () => taste,
    onSome: (data) =>
      TasteData.Success({ data: { ...data, notes: Array.filter(data.notes, ({ id }) => id !== noteId) } }),
  })

const unavailable = Result.fail('Unavailable' as const)

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededReadTaste: ({ taste }) => ({
      model: modifyFields(model, { taste: () => TasteData.Success({ data: taste }) }),
    }),
    // A failed read keeps what is already shown.
    FailedReadTaste: () => ({ model: modifyFields(model, { taste: (taste) => AsyncData.settle(taste, unavailable) }) }),
    ClickedRetry: () =>
      Option.match(AsyncData.revalidateOrLoad(model.taste), {
        onNone: () => ({ model }),
        onSome: (taste) => ({ model: modifyFields(model, { taste: () => taste }), commands: [ReadTaste()] }),
      }),
    // One change at a time: a tap while one saves waits for it.
    ClickedOccasion: ({ occasion }) => {
      if (Choosing.guards.Saving(model.choosing)) return { model }
      const occasions = toggled(shownOccasions(model), occasion)
      return {
        model: modifyFields(model, { choosing: () => Choosing.Saving({ occasions }) }),
        commands: [SaveOccasions({ occasions })],
      }
    },
    SucceededSaveOccasions: ({ taste }) => ({
      model: modifyFields(model, { taste: () => TasteData.Success({ data: taste }), choosing: () => Choosing.Idle() }),
    }),
    FailedSaveOccasions: () => ({ model: modifyFields(model, { choosing: () => Choosing.Failed() }) }),
    ClickedRemoveNote: ({ noteId }) =>
      Removal.guards.Removing(model.removal)
        ? { model }
        : {
            model: modifyFields(model, { removal: () => Removal.Removing({ noteId }) }),
            commands: [RemoveNote({ noteId })],
          },
    SucceededRemoveNote: ({ noteId }) => ({
      model: modifyFields(model, { taste: (taste) => withoutNote(taste, noteId), removal: () => Removal.Idle() }),
    }),
    FailedRemoveNote: ({ noteId }) => ({ model: modifyFields(model, { removal: () => Removal.Failed({ noteId }) }) }),
  })
