import { drawOperationId } from '../OperationIds.ts'
import {
  Look,
  maximumTryOnPieces,
  OperationId,
  Photo,
  PhotoId,
  PieceId,
  TryOn as TryOnContract,
  TryOnId,
} from '@styld/protocol'
import { Array, Effect, Number, Option, Predicate, Result, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../Confirm.ts'
import { Misses, pollWhilePending } from '../Polling.ts'
import { StyldClient } from '../StyldClient.ts'
import * as SaveToBoard from './SaveToBoard.ts'

// Try on (owner, 4 November 2026): one of the person's own Gallery photos, drawn again by Meta's image model with them
// wearing pieces of their wardrobe, for two credits. The tab lists the person's try-ons and makes a new one; one
// try-on opens at its own address (`/try-on/:tryOn`), beside its photo, where it is put on a board or deleted. The
// person says the photo shows them for every try-on; a photo tried on before keeps that word.

// MODEL

export const TryOnsData = AsyncData.Schema(Schema.Array(TryOnContract), Schema.Literal('Unavailable'))
export type TryOnsData = typeof TryOnsData.schema.Type
/** What a try-on is chosen from besides the pieces: the person's Gallery photos and their looks, read together. */
export const Choices = Schema.Struct({ photos: Schema.Array(Photo), looks: Schema.Array(Look) })
export type Choices = typeof Choices.Type
export const ChoicesData = AsyncData.Schema(Choices, Schema.Literal('Unavailable'))
export type ChoicesData = typeof ChoicesData.schema.Type

/** Why a try-on asked for did not start: today's credits are spent, Styld refused it for good (a photo or piece gone,
 * too many at once), or its answer was lost on the way, when Try on asks again under the same operation id so the
 * server answers the first request instead of starting (and charging) a second. */
export const Problem = defineTaggedUnion({ Spent: {}, Refused: {}, Lost: { operationId: OperationId } })
export type Problem = typeof Problem.Type

/** A try-on asked for: not yet, on its way, or stopped with why. */
export const Sending = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { problem: Problem } })
export type Sending = typeof Sending.Type

/** Which picture a phone shows of an open try-on. */
export const Side = Schema.Literals(['before', 'after'])
export type Side = typeof Side.Type

/** What the page shows: the person's try-ons, a new one being chosen, or one try-on beside its photo with Save to
 * board aimed at it. */
export const Screen = defineTaggedUnion({
  List: {},
  New: {
    maybePhotoId: Schema.Option(PhotoId),
    pieceIds: Schema.Array(PieceId),
    thisIsMe: Schema.Boolean,
    sending: Sending,
  },
  Open: { tryOnId: TryOnId, side: Side, saveToBoard: SaveToBoard.Model },
})
export type Screen = typeof Screen.Type
type Choosing = Extract<Screen, { readonly _tag: 'New' }>

export const Model = Schema.Struct({
  tryOns: TryOnsData.schema,
  choices: ChoicesData.schema,
  /** Try-ons started here that a list read before they were made does not have yet. */
  added: Schema.Array(TryOnContract),
  misses: Misses,
  screen: Screen,
  deletion: Deletion,
  /** The operation id of a delete whose answer was lost, so asking again answers the first. */
  maybeDeleteOperationId: Schema.Option(OperationId),
  /** The try-on this page opened at (`/try-on/:tryOn`), which Cancel on a new choice returns to; none on the tab. */
  maybeHome: Schema.Option(TryOnId),
})
export type Model = typeof Model.Type

const fresh = (screen: Screen, maybeHome: Option.Option<TryOnId>): Model => ({
  tryOns: AsyncData.Idle(),
  choices: AsyncData.Idle(),
  added: [],
  misses: 0,
  screen,
  deletion: Deletion.Idle(),
  maybeDeleteOperationId: Option.none(),
  maybeHome,
})

const openScreen = (tryOnId: TryOnId): Screen =>
  Screen.Open({ tryOnId, side: 'after', saveToBoard: SaveToBoard.init({ kind: 'tryOn', id: tryOnId }) })

/** The Lab's tab: the person's try-ons. */
export const init = (): Model => fresh(Screen.List(), Option.none())

/** One try-on's own page. */
export const initOpen = (tryOnId: TryOnId): Model => fresh(openScreen(tryOnId), Option.some(tryOnId))

/** The try-ons as last read, newest first, or none yet. */
export const tryOnsOf = (model: Model): ReadonlyArray<TryOnContract> =>
  Option.getOrElse(AsyncData.getData(model.tryOns), (): ReadonlyArray<TryOnContract> => [])

/** Whether a try-on is still being made. */
export const isMaking = (tryOn: TryOnContract) => tryOn.status === 'admitting' || tryOn.status === 'drawing'

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListTryOns: { tryOns: Schema.Array(TryOnContract) },
  FailedListTryOns: {},
  SucceededListChoices: { choices: Choices },
  FailedListChoices: {},
  ClickedRetry: {},
  TickedTryOnsRefresh: {},
  ClickedNew: {},
  ClickedBack: {},
  SelectedPhoto: { photoId: PhotoId },
  ToggledPiece: { pieceId: PieceId },
  SelectedLook: { pieceIds: Schema.Array(PieceId) },
  ToggledThisIsMe: { isChecked: Schema.Boolean },
  ClickedTryOn: {},
  SucceededStartTryOn: { tryOn: TryOnContract },
  FailedStartTryOn: { problem: Problem },
  ClickedSide: { side: Side },
  ClickedTryAgain: { photoId: PhotoId, pieceIds: Schema.Array(PieceId) },
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeleteTryOn: { tryOnId: TryOnId },
  FailedDeleteTryOn: { operationId: OperationId },
  GotSaveToBoardMessage: { message: SaveToBoard.Message },
})
export type Message = typeof Message.Type

/** Save to board's sheet opened (the app asks for the boards again), a try-on started (the app opens its page), or the
 * open try-on deleted (the app goes back to the list). */
export const OutMessage = defineMessageUnion({
  RequestedBoards: {},
  StartedTryOn: { tryOnId: TryOnId },
  DeletedTryOn: {},
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const ListTryOns = Command.define('ListTryOns', {
  messages: [Message.SucceededListTryOns, Message.FailedListTryOns],
  execute: Effect.gen(function* () {
    const { tryOns } = yield* (yield* (yield* StyldClient).api).tryOn.listTryOns()
    return Message.SucceededListTryOns({ tryOns })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListTryOns())),
})

/** The Gallery's photos and the looks, asked for at once. */
export const ListChoices = Command.define('ListChoices', {
  messages: [Message.SucceededListChoices, Message.FailedListChoices],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const [{ photos }, { looks }] = yield* Effect.all([api.photo.listPhotos(), api.look.listLooks()], {
      concurrency: 'unbounded',
    })
    return Message.SucceededListChoices({ choices: { photos, looks } })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListChoices())),
})

/** Why a start failed: a refusal the server gave for good, today's credits, or anything else, which may have reached
 * the server and is asked again under the same id.
 * @internal Exported for its tests. */
export const problemOf = (error: unknown, operationId: OperationId): Problem =>
  Predicate.isTagged(error, 'LimitReached')
    ? Problem.Spent()
    : Predicate.isTagged(error, 'SlowDown') ||
        Predicate.isTagged(error, 'NotFound') ||
        Predicate.isTagged(error, 'OperationConflict')
      ? Problem.Refused()
      : Problem.Lost({ operationId })

/** Try the photo on with the pieces, under a new operation id or the one a lost answer had. */
export const StartTryOn = Command.define('StartTryOn', {
  args: { photoId: PhotoId, pieceIds: Schema.Array(PieceId), maybeOperationId: Schema.Option(OperationId) },
  messages: [Message.SucceededStartTryOn, Message.FailedStartTryOn],
  execute: ({ photoId, pieceIds, maybeOperationId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(maybeOperationId)
      return yield* Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        const tryOn = yield* api.tryOn.startTryOn({ payload: { operationId, photoId, pieceIds, thisIsMe: true } })
        return Message.SucceededStartTryOn({ tryOn })
      }).pipe(
        Effect.catch((error) => Effect.succeed(Message.FailedStartTryOn({ problem: problemOf(error, operationId) }))),
      )
    }),
})

/** Delete the try-on under a new operation id or the one a lost answer had; one already gone is deleted. */
export const DeleteTryOn = Command.define('DeleteTryOn', {
  args: { tryOnId: TryOnId, maybeOperationId: Schema.Option(OperationId) },
  messages: [Message.SucceededDeleteTryOn, Message.FailedDeleteTryOn],
  execute: ({ tryOnId, maybeOperationId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(maybeOperationId)
      return yield* Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        yield* api.tryOn.deleteTryOn({ params: { tryOnId }, payload: { operationId } })
        return Message.SucceededDeleteTryOn({ tryOnId })
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            Predicate.isTagged(error, 'NotFound')
              ? Message.SucceededDeleteTryOn({ tryOnId })
              : Message.FailedDeleteTryOn({ operationId }),
          ),
        ),
      )
    }),
})

// UPDATE

const unavailable = 'Unavailable' as const

type Services = StyldClient | SecureRandom.SecureRandom
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const tryOnsCache = (revalidate: (tryOns: TryOnsData) => Option.Option<TryOnsData>) =>
  Update.refresh<Model, Message, ReadonlyArray<TryOnContract>, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.tryOns),
    revalidate,
    write: (model: Model, tryOns: TryOnsData) => modifyFields(model, { tryOns: () => tryOns }),
    load: ListTryOns(),
  })

/** Opening the page, or Try again: what is here stays while the try-ons, the Gallery's photos and the looks are asked
 * for again; a first visit asks; a page that stopped following its try-ons starts over. */
export const revisit = Update.combine<Model, Message, StyldClient>([
  (stepModel) => ({ model: modifyFields(stepModel, { misses: () => 0 }) }),
  tryOnsCache(AsyncData.revalidateOrLoad),
  Update.refresh<Model, Message, Choices, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.choices),
    revalidate: AsyncData.revalidateOrLoad,
    write: (model: Model, choices: ChoicesData) => modifyFields(model, { choices: () => choices }),
    load: ListChoices(),
  }),
])

/** What a try-on's own page asks for first. */
export const load = () => [ListTryOns(), ListChoices()]

/** The try-ons as read, with any started here that the read did not have yet, newest first. */
const listed = (model: Model, tryOns: ReadonlyArray<TryOnContract>): Model => {
  const missing = Array.filter(model.added, (added) => !tryOns.some(({ id }) => id === added.id))
  return modifyFields(model, {
    tryOns: () => TryOnsData.Success({ data: [...missing, ...tryOns] }),
    added: () => missing,
    misses: () => 0,
  })
}

/** Whether the person said before that this photo shows them: a try-on of it was started. */
const triedOnBefore = (model: Model, photoId: PhotoId) => tryOnsOf(model).some((tryOn) => tryOn.photoId === photoId)

/** A fresh choice: the photo and pieces given, ticked as the person only for a photo tried on before. */
const choosing = (model: Model, maybePhotoId: Option.Option<PhotoId>, pieceIds: ReadonlyArray<PieceId>): Choosing =>
  Screen.New({
    maybePhotoId,
    pieceIds,
    thisIsMe: Option.exists(maybePhotoId, (photoId) => triedOnBefore(model, photoId)),
    sending: Sending.Idle(),
  })

/** A change to the choice being made, left alone while it is sent; a choice that changed is a new try-on, so a lost
 * answer's id is dropped. */
const chose = (model: Model, change: (screen: Choosing) => Choosing): UpdateReturn => {
  const screen = model.screen
  if (!Screen.guards.New(screen) || Sending.guards.Sending(screen.sending)) {
    return { model }
  }
  return {
    model: modifyFields(model, { screen: () => modifyFields(change(screen), { sending: () => Sending.Idle() }) }),
  }
}

/** The try-on asked for did not start: the choice stays, with why. */
const failedStart = (model: Model, problem: Problem): UpdateReturn => {
  const screen = model.screen
  if (!Screen.guards.New(screen)) {
    return { model }
  }
  return {
    model: modifyFields(model, { screen: () => modifyFields(screen, { sending: () => Sending.Failed({ problem }) }) }),
  }
}

const toggled = (pieceIds: ReadonlyArray<PieceId>, pieceId: PieceId) =>
  pieceIds.includes(pieceId)
    ? Array.filter(pieceIds, (id) => id !== pieceId)
    : pieceIds.length >= maximumTryOnPieces
      ? pieceIds
      : [...pieceIds, pieceId]

/** The operation id a Try on is sent under: a lost answer's, else a new one. */
const retriedOperation = (sending: Sending): Option.Option<OperationId> =>
  Sending.guards.Failed(sending) && Problem.guards.Lost(sending.problem)
    ? Option.some(sending.problem.operationId)
    : Option.none()

/** Try on: sent once the photo, a piece and the person's word are there. */
const started = (model: Model): UpdateReturn => {
  const screen = model.screen
  if (!Screen.guards.New(screen) || Sending.guards.Sending(screen.sending) || !screen.thisIsMe) {
    return { model }
  }
  return Option.match(screen.maybePhotoId, {
    onNone: () => ({ model }),
    onSome: (photoId) =>
      Array.isReadonlyArrayEmpty(screen.pieceIds)
        ? { model }
        : {
            model: modifyFields(model, {
              screen: () => modifyFields(screen, { sending: () => Sending.Sending() }),
            }),
            commands: [
              StartTryOn({ photoId, pieceIds: screen.pieceIds, maybeOperationId: retriedOperation(screen.sending) }),
            ],
          },
  })
}

/** A try-on started: it joins the list, and its page opens unless the person went back while it was sent. */
const startedTryOn = (model: Model, tryOn: TryOnContract): UpdateReturn => {
  const withIt = modifyFields(model, {
    added: (added) => [tryOn, ...added],
    tryOns: () => TryOnsData.Success({ data: [tryOn, ...tryOnsOf(model).filter(({ id }) => id !== tryOn.id)] }),
  })
  const screen = model.screen
  return Screen.guards.New(screen) && Sending.guards.Sending(screen.sending)
    ? {
        model: modifyFields(withIt, { screen: () => choosing(model, Option.none(), []) }),
        outMessage: OutMessage.StartedTryOn({ tryOnId: tryOn.id }),
      }
    : { model: withIt }
}

/** Back from a new choice: to the try-on this page opened at, else the list. */
const wentBack = (model: Model): UpdateReturn => ({
  model: modifyFields(model, {
    screen: () => Option.match(model.maybeHome, { onNone: () => Screen.List(), onSome: openScreen }),
    deletion: () => Deletion.Idle(),
  }),
})

/** Before or after, on a phone. */
const turned = (model: Model, side: Side): UpdateReturn => {
  const screen = model.screen
  if (!Screen.guards.Open(screen)) {
    return { model }
  }
  return { model: modifyFields(model, { screen: () => modifyFields(screen, { side: () => side }) }) }
}

const deletionAt = (model: Model, deletion: Deletion): UpdateReturn => ({
  model: modifyFields(model, { deletion: () => deletion }),
})

const confirmDelete = (model: Model): UpdateReturn => {
  const screen = model.screen
  if (!Screen.guards.Open(screen) || Deletion.guards.Deleting(model.deletion)) {
    return { model }
  }
  return {
    model: modifyFields(model, { deletion: () => Deletion.Deleting() }),
    commands: [DeleteTryOn({ tryOnId: screen.tryOnId, maybeOperationId: model.maybeDeleteOperationId })],
  }
}

const deleted = (model: Model, tryOnId: TryOnId): UpdateReturn => ({
  model: modifyFields(model, {
    deletion: () => Deletion.Idle(),
    maybeDeleteOperationId: () => Option.none(),
    added: Array.filter((tryOn) => tryOn.id !== tryOnId),
    tryOns: (tryOns) =>
      Option.match(AsyncData.getData(tryOns), {
        onNone: () => tryOns,
        onSome: (data) => TryOnsData.Success({ data: Array.filter(data, (tryOn) => tryOn.id !== tryOnId) }),
      }),
  }),
  outMessage: OutMessage.DeletedTryOn(),
})

/** Save to board, while a try-on is open. */
const foldSaveToBoard = Update.foldChild({
  update: SaveToBoard.update,
  read: (model: Model) => (Screen.guards.Open(model.screen) ? Option.some(model.screen.saveToBoard) : Option.none()),
  write: (model: Model, saveToBoard: SaveToBoard.Model): Model => {
    const screen = model.screen
    return Screen.guards.Open(screen)
      ? modifyFields(model, { screen: () => modifyFields(screen, { saveToBoard: () => saveToBoard }) })
      : model
  },
  toParentMessage: (message: SaveToBoard.Message) => Message.GotSaveToBoardMessage({ message }),
  toParentOutMessage: SaveToBoard.OutMessage.match({ RequestedBoards: () => OutMessage.RequestedBoards() }),
})

const reads = (model: Model) => ({
  SucceededListTryOns: ({ tryOns }: { readonly tryOns: ReadonlyArray<TryOnContract> }) => ({
    model: listed(model, tryOns),
  }),
  FailedListTryOns: () => ({
    model: modifyFields(model, {
      tryOns: (tryOns) => AsyncData.settle(tryOns, Result.fail(unavailable)),
      misses: Number.increment,
    }),
  }),
  SucceededListChoices: ({ choices }: { readonly choices: Choices }) => ({
    model: modifyFields(model, { choices: () => ChoicesData.Success({ data: choices }) }),
  }),
  FailedListChoices: () => ({
    model: modifyFields(model, { choices: (choices) => AsyncData.settle(choices, Result.fail(unavailable)) }),
  }),
  ClickedRetry: () => revisit(model),
  TickedTryOnsRefresh: () => tryOnsCache(AsyncData.revalidate)(model),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ...reads(model),
    ClickedNew: () => ({ model: modifyFields(model, { screen: () => choosing(model, Option.none(), []) }) }),
    ClickedBack: () => wentBack(model),
    SelectedPhoto: ({ photoId }) => chose(model, (screen) => choosing(model, Option.some(photoId), screen.pieceIds)),
    ToggledPiece: ({ pieceId }) =>
      chose(model, (screen) => modifyFields(screen, { pieceIds: (pieceIds) => toggled(pieceIds, pieceId) })),
    SelectedLook: ({ pieceIds }) =>
      chose(model, (screen) => modifyFields(screen, { pieceIds: () => pieceIds.slice(0, maximumTryOnPieces) })),
    ToggledThisIsMe: ({ isChecked }) => chose(model, (screen) => modifyFields(screen, { thisIsMe: () => isChecked })),
    ClickedTryOn: () => started(model),
    SucceededStartTryOn: ({ tryOn }) => startedTryOn(model, tryOn),
    FailedStartTryOn: ({ problem }) => failedStart(model, problem),
    ClickedSide: ({ side }) => turned(model, side),
    ClickedTryAgain: ({ photoId, pieceIds }) => ({
      model: modifyFields(model, { screen: () => choosing(model, Option.some(photoId), pieceIds) }),
    }),
    ClickedDelete: () => deletionAt(model, Deletion.Confirming()),
    ClickedCancelDelete: () => deletionAt(model, Deletion.Idle()),
    ClickedConfirmDelete: () => confirmDelete(model),
    SucceededDeleteTryOn: ({ tryOnId }) => deleted(model, tryOnId),
    FailedDeleteTryOn: ({ operationId }) => ({
      model: modifyFields(model, {
        deletion: () => Deletion.Failed(),
        maybeDeleteOperationId: () => Option.some(operationId),
      }),
    }),
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
  })

// SUBSCRIPTION

/** The try-ons are asked for again while one is being drawn. */
const whileMaking = pollWhilePending<Model, Message>({
  pendingIds: (model) => Array.map(Array.filter(tryOnsOf(model), isMaking), ({ id }) => id),
  misses: (model) => model.misses,
  tick: Message.TickedTryOnsRefresh(),
})

/** The tab's: its try-ons being drawn. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({ tryOnsWhileMaking: whileMaking }))

/** A try-on's own page's, under a key of its own beside the tab's. */
export const pageSubscriptions = Subscription.make<Model, Message>()(() => ({ tryOnPageWhileMaking: whileMaking }))
