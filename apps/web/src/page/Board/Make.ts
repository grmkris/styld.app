import { Dialog } from '@foldkit/ui'
import { BoardId, Generation, GenerationKind, OperationId } from '@styld/protocol'
import { Duration, Effect, Option, Predicate, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../../StyldClient.ts'

// Make with Styld, on a board's page: one picture from a sentence, or a mood board of a few with the person's pieces.
// The ask goes in the background; the page follows it, and the board reloads when it is done.

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

export const Model = Schema.Struct({
  boardId: Schema.String,
  sheet: Dialog.Model,
  kind: GenerationKind,
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
  sheet: Dialog.init({ id: 'board-make' }),
  kind: 'moodBoard',
  words: '',
  operationId: Option.none(),
  job: Job.Idle(),
  missedPolls: 0,
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedMake: {},
  GotSheetMessage: { message: Dialog.Message },
  ChoseKind: { kind: GenerationKind },
  ChangedWords: { words: Schema.String },
  SubmittedMake: {},
  SucceededAsk: { generation: Generation },
  FailedAsk: { problem: MakeProblem, operationId: Schema.Option(Schema.String) },
  SucceededPoll: { generation: Generation },
  FailedPoll: { generationId: Schema.String },
  ClickedDismiss: {},
})
export type Message = typeof Message.Type

/** The ask reached an end: the board has its new pictures, or none came. */
export const OutMessage = defineMessageUnion({ FinishedMaking: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const problemOf = (error: unknown): MakeProblem => {
  if (Predicate.isTagged(error, 'DailyLimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'PromptRefused')) return 'refused'
  if (Predicate.isTagged(error, 'GenerateSlowDown')) return 'slowDown'
  return 'failed'
}

/** Ask Styld for pictures, under an operation id drawn once for this ask.
 * @internal Exported for its tests. */
export const AskForPictures = Command.define('AskForPictures', {
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
        const generation = yield* args.kind === 'picture'
          ? api.generation.generatePicture(request)
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
const openSheet = Update.foldChildStep({ update: Dialog.open, ...sheetFold })
const closeSheet = Update.foldChildStep({ update: Dialog.close, ...sheetFold })

/** Send the words: one ask at a time, with the words the person typed. */
const submitted = (model: Model): UpdateReturn => {
  const prompt = model.words.trim()
  if (prompt.length < 3 || Job.guards.Asking(model.job) || Job.guards.Running(model.job)) return { model }
  return {
    model: modifyFields(model, { job: () => Job.Asking() }),
    commands: [AskForPictures({ boardId: model.boardId, kind: model.kind, prompt, operationId: model.operationId })],
  }
}

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
    // Another kind is another ask: it starts under a new operation.
    ChoseKind: ({ kind }) => ({ model: modifyFields(model, { kind: () => kind, operationId: () => Option.none() }) }),
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
    ClickedDismiss: () => ({ model: modifyFields(model, { job: () => Job.Idle() }) }),
  })
