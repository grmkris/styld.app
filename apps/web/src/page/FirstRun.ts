import { Audience, BoardId, FoundBoard, Occasion } from '@styld/protocol'
import { Array, Effect, Schema } from 'effect'
import { Command, Dom, Mount } from 'foldkit'
import { DEVTOOLS_HOST_ID } from 'foldkit/devtools-host'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { heldIn } from './Held.ts'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import type { Update } from 'foldkit'
import { drawOperationId } from '../OperationIds.ts'
import { StyldClient } from '../StyldClient.ts'

// The first run (owner, 4 November 2026: "Styld learns the person", shown to everyone once): over Home, four short
// steps, each skippable: what What's new shows first (Show me), boards to save from the house boards, the occasions
// they dress for, and their first clothes. Each answer saves as it is given, so leaving halfway keeps what was said;
// finishing or skipping it marks it done, and it is not offered again.

// MODEL

export const Step = defineTaggedUnion({ ShowMe: {}, Boards: {}, Occasions: {}, Clothes: {} })
export type Step = typeof Step.Type

/** Closed (not asked, done, or not known yet) or open at a step. */
export const Stage = defineTaggedUnion({ Closed: {}, Open: { step: Step } })

export const Model = Schema.Struct({
  stage: Stage,
  /** The house boards to pick from, in the order of the person's Show me; none while they are read. */
  boards: Schema.Array(FoundBoard),
  picked: Schema.Array(BoardId),
  occasions: Schema.Array(Occasion),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ stage: Stage.Closed(), boards: [], picked: [], occasions: [] })

/** The most boards offered, and how many a person is asked to pick. */
export const boardsOffered = 12
export const boardsAsked = 3

export const dialogId = 'first-run'

// MESSAGE

export const Message = defineMessageUnion({
  SucceededReadTaste: { done: Schema.Boolean },
  FailedReadTaste: {},
  SucceededReadBoards: { boards: Schema.Array(FoundBoard) },
  FailedReadBoards: {},
  ClickedShowMe: { showMe: Schema.NullOr(Audience) },
  ClickedBoard: { boardId: BoardId },
  ClickedOccasion: { occasion: Occasion },
  ClickedNext: {},
  ClickedSkipAll: {},
  CompletedSave: {},
  CompletedHold: {},
})
export type Message = typeof Message.Type

/** An answer changed what Home shows: Show me was answered, or the first run ended. */
export const OutMessage = defineMessageUnion({ AnsweredShowMe: {}, Finished: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const ReadFirstRun = Command.define('ReadFirstRun', {
  messages: [Message.SucceededReadTaste, Message.FailedReadTaste],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const taste = yield* api.taste.getTaste()
    return Message.SucceededReadTaste({ done: taste.firstRunDone })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadTaste())),
})

/** The house boards, in the order the person's Show me gives Explore's Edits from Styld. */
export const ReadHouseBoards = Command.define('ReadHouseBoards', {
  messages: [Message.SucceededReadBoards, Message.FailedReadBoards],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const explore = yield* api.public.explore({ query: {} })
    return Message.SucceededReadBoards({ boards: explore.edits.slice(0, boardsOffered) })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadBoards())),
})

/** A write the first run makes as it goes; one that fails is left, as the answer can be given again later. */
const saving = <E, R>(write: Effect.Effect<unknown, E, R>) =>
  write.pipe(
    Effect.as(Message.CompletedSave()),
    Effect.orElseSucceed(() => Message.CompletedSave()),
  )

export const SaveFirstRunShowMe = Command.define('SaveFirstRunShowMe', {
  args: { showMe: Schema.NullOr(Audience) },
  messages: [Message.CompletedSave],
  execute: ({ showMe }) =>
    saving(
      Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        yield* api.preferences.setShowMe({ payload: { operationId: yield* drawOperationId(), showMe } })
      }),
    ),
})

export const SaveFirstRunBoards = Command.define('SaveFirstRunBoards', {
  args: { boardIds: Schema.Array(BoardId) },
  messages: [Message.CompletedSave],
  execute: ({ boardIds }) =>
    saving(
      Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        yield* Effect.forEach(boardIds, (boardId) =>
          Effect.flatMap(drawOperationId(), (operationId) =>
            api.social.setSaved({ payload: { operationId, target: { _tag: 'SavedBoard', boardId }, saved: true } }),
          ),
        )
      }),
    ),
})

export const SaveFirstRunOccasions = Command.define('SaveFirstRunOccasions', {
  args: { occasions: Schema.Array(Occasion) },
  messages: [Message.CompletedSave],
  execute: ({ occasions }) =>
    saving(
      Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        yield* api.taste.setOccasions({ payload: { operationId: yield* drawOperationId(), occasions } })
      }),
    ),
})

export const FinishFirstRun = Command.define('FinishFirstRun', {
  messages: [Message.CompletedSave],
  execute: saving(
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.taste.finishFirstRun({ payload: { operationId: yield* drawOperationId() } })
    }),
  ),
})

// MOUNT

/** Hold the first run as modal while it is open: the page behind goes inert and stops scrolling. */
export const HoldFirstRun = Mount.define('HoldFirstRun', {
  messages: [Message.CompletedHold],
  execute: ({ element }) =>
    Effect.acquireRelease(
      Dom.showDialog(`#${element.id}`, { isModal: true, allowedOutsideSelectors: [`#${DEVTOOLS_HOST_ID}`] }).pipe(
        Effect.tap((acquired) => (acquired ? Dom.lockScroll : Effect.void)),
        Effect.orElseSucceed(() => false),
      ),
      (acquired) => (acquired ? Dom.releaseDialogResources(element.id) : Effect.void),
    ).pipe(Effect.as(Message.CompletedHold())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

/** How Home holds it: in its `firstRun`, its Messages wrapped in Home's. */
export const heldBy = <Parent extends { readonly firstRun: Model }, ParentMessage>(
  toParentMessage: (message: Message) => ParentMessage,
) => heldIn<Parent, 'firstRun', Model, Message, ParentMessage>('firstRun', toParentMessage)

/** Opening Home: whether the first run is behind the person. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Stage.guards.Closed(model.stage) ? { model, commands: [ReadFirstRun()] } : { model }

const at = (model: Model, step: Step): Model => modifyFields(model, { stage: () => Stage.Open({ step }) })

/** On from the step the person is at, saving what they chose there. */
const next = (model: Model, step: Step): UpdateReturn =>
  Step.match(step, {
    ShowMe: (): UpdateReturn => ({ model: at(model, Step.Boards()), commands: [ReadHouseBoards()] }),
    Boards: (): UpdateReturn => ({
      model: at(model, Step.Occasions()),
      commands: model.picked.length === 0 ? [] : [SaveFirstRunBoards({ boardIds: model.picked })],
    }),
    // The last step: reaching it marks the first run done, so going on to add clothes loses nothing.
    Occasions: (): UpdateReturn => ({
      model: at(model, Step.Clothes()),
      commands:
        model.occasions.length === 0
          ? [FinishFirstRun()]
          : [SaveFirstRunOccasions({ occasions: model.occasions }), FinishFirstRun()],
    }),
    Clothes: (): UpdateReturn => ({
      model: modifyFields(model, { stage: () => Stage.Closed() }),
      outMessage: OutMessage.Finished(),
    }),
  })

/** A value in a list, or out of it if it was there. */
const toggle = <A>(values: ReadonlyArray<A>, value: A): ReadonlyArray<A> =>
  values.includes(value) ? values.filter((each) => each !== value) : [...values, value]

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededReadTaste: ({ done }) => (done ? { model } : { model: at(model, Step.ShowMe()) }),
    // Not known is not asked: Home stays as it is.
    FailedReadTaste: () => ({ model }),
    SucceededReadBoards: ({ boards }) => ({ model: modifyFields(model, { boards: () => boards }) }),
    FailedReadBoards: () => ({ model }),
    ClickedShowMe: ({ showMe }) => ({
      model: at(model, Step.Boards()),
      commands: [SaveFirstRunShowMe({ showMe }), ReadHouseBoards()],
      outMessage: OutMessage.AnsweredShowMe(),
    }),
    ClickedBoard: ({ boardId }) => ({ model: modifyFields(model, { picked: (picked) => toggle(picked, boardId) }) }),
    ClickedOccasion: ({ occasion }) => ({
      model: modifyFields(model, {
        occasions: (occasions) => Occasion.literals.filter((each) => toggle(occasions, occasion).includes(each)),
      }),
    }),
    ClickedNext: () => (Stage.guards.Open(model.stage) ? next(model, model.stage.step) : { model }),
    // Skipping the rest: done, and not offered again.
    ClickedSkipAll: () => ({
      model: modifyFields(model, { stage: () => Stage.Closed() }),
      commands: [FinishFirstRun()],
      outMessage: OutMessage.Finished(),
    }),
    CompletedSave: () => ({ model }),
    CompletedHold: () => ({ model }),
  })

/** Whether a board is picked. */
export const isPicked = (model: Model, boardId: BoardId) => Array.contains(model.picked, boardId)
