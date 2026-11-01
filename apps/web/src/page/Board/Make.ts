import { Dialog, RadioGroup } from '@foldkit/ui'
import { BoardId, Generation, GenerationKind, OperationId } from '@styld/protocol'
import { Duration, Effect, Option, Predicate, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../../StyldClient.ts'

// Make with Styld, on a board's page (owner, 2026-10-31): a mood board of the person's own pieces from one sentence,
// or a small sticker drawn from their words. The ask goes in the background; the page follows it, and the board
// reloads when it is done. A board opened again while its ask is being made follows it from where it is.

// MODEL

/** Why an ask did not start: today's credits are spent, the words were refused, too many at once, or it failed. */
export const MakeProblem = Schema.Literals(['dailyLimit', 'refused', 'slowDown', 'failed'])
export type MakeProblem = typeof MakeProblem.Type

export const Job = defineTaggedUnion({
  Idle: {},
  Asking: {},
  Running: { generation: Generation },
  Finished: { generation: Generation },
  Failed: { problem: MakeProblem },
})
export type Job = typeof Job.Type

/** The kinds the sheet offers, in its order. */
export const kinds: ReadonlyArray<GenerationKind> = ['moodBoard', 'sticker']

/** The two kinds as one radio group: arrows move between them, and the chosen one is the group's one tab stop. */
export const KindRadioGroup = RadioGroup.create<GenerationKind>()

export const Model = Schema.Struct({
  boardId: Schema.String,
  sheet: Dialog.Model,
  kind: GenerationKind,
  kindChoice: RadioGroup.Model,
  words: Schema.String,
  /** Drawn once per ask and kept for its retries, so a lost answer never makes a second job. */
  operationId: Schema.Option(Schema.String),
  job: Job,
  /** Polls in a row that did not get through; after a few the page stops following and says so. */
  missedPolls: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  sheet: Dialog.init({ id: 'board-make', isAnimated: true }),
  kind: 'moodBoard',
  kindChoice: RadioGroup.init({ id: 'board-make-kind' }),
  words: '',
  operationId: Option.none(),
  job: Job.Idle(),
  missedPolls: 0,
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedMake: {},
  GotSheetMessage: { message: Dialog.Message },
  GotKindChoiceMessage: { message: RadioGroup.Message },
  ChangedWords: { words: Schema.String },
  SubmittedMake: {},
  SucceededAsk: { generation: Generation },
  FailedAsk: { problem: MakeProblem, operationId: Schema.Option(Schema.String) },
  SucceededPoll: { generation: Generation },
  FailedPoll: { generationId: Schema.String },
  SucceededFindRunning: { generation: Schema.NullOr(Generation) },
  FailedFindRunning: {},
  ClickedDismiss: {},
})
export type Message = typeof Message.Type

/** The ask reached an end: the board has its new pieces or sticker, or nothing came. */
export const OutMessage = defineMessageUnion({ FinishedMaking: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const problemOf = (error: unknown): MakeProblem => {
  if (Predicate.isTagged(error, 'LimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'PromptRefused')) return 'refused'
  if (Predicate.isTagged(error, 'SlowDown')) return 'slowDown'
  return 'failed'
}

/** Ask Styld for a mood board or a sticker, under an operation id drawn once for this ask.
 * @internal Exported for its tests. */
export const AskToMake = Command.define('AskToMake', {
  args: {
    boardId: Schema.String,
    kind: GenerationKind,
    prompt: Schema.String,
    operationId: Schema.Option(Schema.String),
  },
  messages: [Message.SucceededAsk, Message.FailedAsk],
  execute: (args) =>
    Effect.gen(function* () {
      const drawn = Option.isSome(args.operationId)
        ? args.operationId.value
        : yield* (yield* Crypto.Crypto).randomUUIDv4()
      const asked = Effect.gen(function* () {
        const operationId = yield* Schema.decodeUnknownEffect(OperationId)(drawn)
        const boardId = yield* Schema.decodeUnknownEffect(BoardId)(args.boardId)
        const api = yield* (yield* StyldClient).api
        const request = { params: { boardId }, payload: { operationId, prompt: args.prompt } }
        const generation = yield* args.kind === 'sticker'
          ? api.generation.makeSticker(request)
          : api.generation.makeMoodBoard(request)
        return Message.SucceededAsk({ generation })
      })
      // Only a failure that may not have reached Styld keeps the operation id, so trying again asks for the same job.
      return yield* asked.pipe(
        Effect.catch((error) => {
          const problem = problemOf(error)
          return Effect.succeed(
            Message.FailedAsk({ problem, operationId: problem === 'failed' ? Option.some(drawn) : Option.none() }),
          )
        }),
      )
    }).pipe(Effect.orElseSucceed(() => Message.FailedAsk({ problem: 'failed', operationId: Option.none() }))),
})

/** Polls in a row that may fail before the page stops following a job. */
const mostMissedPolls = 5

/** How long the page waits before asking how the pictures are going. */
const pollDelay = Duration.millis(1500)

/** Ask again, after a moment, how the pictures are going.
 * @internal Exported for its tests. */
export const PollGeneration = Command.define('PollGeneration', {
  args: { generationId: Schema.String },
  messages: [Message.SucceededPoll, Message.FailedPoll],
  execute: ({ generationId }) =>
    Effect.gen(function* () {
      yield* Effect.sleep(pollDelay)
      const api = yield* (yield* StyldClient).api
      const id = yield* Schema.decodeUnknownEffect(Generation.fields.id)(generationId)
      return Message.SucceededPoll({ generation: yield* api.generation.generation({ params: { generationId: id } }) })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPoll({ generationId }))),
})

/** Ask whether the board has an ask still being made, so a board opened again follows it. */
const FindRunningGeneration = Command.define('FindRunningGeneration', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededFindRunning, Message.FailedFindRunning],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const id = yield* Schema.decodeUnknownEffect(BoardId)(boardId)
      const { generation } = yield* api.generation.runningGeneration({ params: { boardId: id } })
      return Message.SucceededFindRunning({ generation })
    }).pipe(Effect.orElseSucceed(() => Message.FailedFindRunning())),
})

/** Once the person's own board has loaded: pick up an ask made before they left it. */
export const resume = (model: Model): ReadonlyArray<Command.Command<Message, never, StyldClient>> => [
  FindRunningGeneration({ boardId: model.boardId }),
]

// UPDATE

type Services = StyldClient | Crypto.Crypto
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const finished = (generation: Generation) => ['done', 'refused', 'failed'].includes(generation.status)

const sheetFold = {
  read: (model: Model) => Option.some(model.sheet),
  write: (model: Model, sheet: Dialog.Model) => modifyFields(model, { sheet: () => sheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotSheetMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
}
const foldSheet = Update.foldChild({ update: Dialog.update, ...sheetFold })

const foldKindChoice = Update.foldChild({
  update: KindRadioGroup.update,
  read: (model: Model) => Option.some(model.kindChoice),
  write: (model: Model, kindChoice: RadioGroup.Model) => modifyFields(model, { kindChoice: () => kindChoice }),
  toParentMessage: (message: RadioGroup.Message) => Message.GotKindChoiceMessage({ message }),
  foldOutMessage: RadioGroup.OutMessage.match<
    Update.StepWithOutMessage<Model, Message, OutMessage, Services>,
    RadioGroup.OutMessage<GenerationKind>
  >({
    // Another kind is another ask: it starts under a new operation.
    Selected:
      ({ value }) =>
      (stepModel) => ({ model: modifyFields(stepModel, { kind: () => value, operationId: () => Option.none() }) }),
  }),
})
const openSheet = Update.foldChildStep({ update: Dialog.open, ...sheetFold })
const closeSheet = Update.foldChildStep({ update: Dialog.close, ...sheetFold })

/** The fewest characters, spaces aside at either end, that Styld makes pictures from. */
const fewestCharacters = 3

/** Whether Make can send: words enough, and no ask already on its way or being made. The button reads disabled
 * otherwise. */
export const canMake = (model: Model): boolean =>
  model.words.trim().length >= fewestCharacters && !Job.guards.Asking(model.job) && !Job.guards.Running(model.job)

/** Send the words: one ask at a time, with the words the person typed. */
const submitted = (model: Model): UpdateReturn =>
  canMake(model)
    ? {
        model: modifyFields(model, { job: () => Job.Asking() }),
        commands: [
          AskToMake({
            boardId: model.boardId,
            kind: model.kind,
            prompt: model.words.trim(),
            operationId: model.operationId,
          }),
        ],
      }
    : { model }

/** The job moved on: follow it while it runs; once it ends, the board reloads. */
const polled = (model: Model, generation: Generation): UpdateReturn =>
  finished(generation)
    ? {
        model: modifyFields(model, { job: () => Job.Finished({ generation }) }),
        outMessage: OutMessage.FinishedMaking(),
      }
    : {
        model: modifyFields(model, { job: () => Job.Running({ generation }) }),
        commands: [PollGeneration({ generationId: generation.id })],
      }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // Opening the sheet clears what the last ask said, unless one is still running.
    ClickedMake: () =>
      openSheet(Job.guards.Running(model.job) ? model : modifyFields(model, { job: () => Job.Idle() })),
    GotSheetMessage: ({ message: sheetMessage }) => foldSheet(model, sheetMessage),
    GotKindChoiceMessage: ({ message: kindMessage }) => foldKindChoice(model, kindMessage),
    ChangedWords: ({ words }) => ({
      model: modifyFields(model, { words: () => words, operationId: () => Option.none() }),
    }),
    SubmittedMake: () => submitted(model),
    SucceededAsk: ({ generation }) => {
      const closed = closeSheet(modifyFields(model, { words: () => '', operationId: () => Option.none() }))
      const asked = polled(closed.model, generation)
      return { ...asked, commands: [...(closed.commands ?? []), ...(asked.commands ?? [])] }
    },
    FailedAsk: ({ problem, operationId }) => ({
      model: modifyFields(model, { job: () => Job.Failed({ problem }), operationId: () => operationId }),
    }),
    SucceededPoll: ({ generation }) => polled(modifyFields(model, { missedPolls: () => 0 }), generation),
    // A poll that did not get through asks again, a few times; the job goes on on the server either way.
    FailedPoll: ({ generationId }) =>
      model.missedPolls + 1 >= mostMissedPolls
        ? { model: modifyFields(model, { job: () => Job.Failed({ problem: 'failed' }), missedPolls: () => 0 }) }
        : {
            model: modifyFields(model, { missedPolls: (missed) => missed + 1 }),
            commands: [PollGeneration({ generationId })],
          },
    // Followed only while nothing else is: an ask made on this visit answers for itself.
    SucceededFindRunning: ({ generation }) =>
      generation !== null && Job.guards.Idle(model.job) ? polled(model, generation) : { model },
    FailedFindRunning: () => ({ model }),
    ClickedDismiss: () => ({ model: modifyFields(model, { job: () => Job.Idle() }) }),
  })
