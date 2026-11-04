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
// wearing pieces of their wardrobe, for two credits. The person says once per photo that it shows them; the page
// follows a try-on until it is drawn, shows it beside the photo, and puts it on a board or deletes it.

// MODEL

export const TryOnsData = AsyncData.Schema(Schema.Array(TryOnContract), Schema.Literal('Unavailable'))
export type TryOnsData = typeof TryOnsData.schema.Type
/** What a try-on is chosen from besides the pieces: the person's Gallery photos and their looks, read together. */
export const Choices = Schema.Struct({ photos: Schema.Array(Photo), looks: Schema.Array(Look) })
export type Choices = typeof Choices.Type
export const ChoicesData = AsyncData.Schema(Choices, Schema.Literal('Unavailable'))
export type ChoicesData = typeof ChoicesData.schema.Type

/** A try-on asked for: not yet, on its way, or refused (today's credits spent, or anything else). A request whose
 * answer was lost keeps its operation id, so Try on again asks the server for the same try-on. */
export const Sending = defineTaggedUnion({
  Idle: {},
  Sending: {},
  Failed: { spent: Schema.Boolean, maybeOperationId: Schema.Option(OperationId) },
})
export type Sending = typeof Sending.Type

/** What the page shows: the person's try-ons, a new one being chosen, or one try-on beside its photo. */
export const Screen = defineTaggedUnion({
  List: {},
  New: {
    maybePhotoId: Schema.Option(PhotoId),
    pieceIds: Schema.Array(PieceId),
    thisIsMe: Schema.Boolean,
    sending: Sending,
  },
  Open: { tryOnId: TryOnId, side: Schema.Literals(['before', 'after']) },
})
export type Screen = typeof Screen.Type

export const Model = Schema.Struct({
  tryOns: TryOnsData.schema,
  choices: ChoicesData.schema,
  /** Try-ons started here that a list read before they were made does not have yet. */
  added: Schema.Array(TryOnContract),
  misses: Misses,
  screen: Screen,
  deletion: Deletion,
  saveToBoard: SaveToBoard.Model,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  tryOns: AsyncData.Idle(),
  choices: AsyncData.Idle(),
  added: [],
  misses: 0,
  screen: Screen.List(),
  deletion: Deletion.Idle(),
  saveToBoard: SaveToBoard.init({ kind: 'tryOn', id: '' }),
})

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
  ToggledThisIsMe: {},
  ClickedTryOn: {},
  SucceededStartTryOn: { tryOn: TryOnContract },
  FailedStartTryOn: { spent: Schema.Boolean, maybeOperationId: Schema.Option(OperationId) },
  ClickedOpen: { tryOnId: TryOnId },
  ClickedSide: { side: Schema.Literals(['before', 'after']) },
  ClickedTryAgain: { photoId: PhotoId, pieceIds: Schema.Array(PieceId) },
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedConfirmDelete: {},
  SucceededDeleteTryOn: { tryOnId: TryOnId },
  FailedDeleteTryOn: {},
  GotSaveToBoardMessage: { message: SaveToBoard.Message },
})
export type Message = typeof Message.Type

/** Save to board's sheet opened: the app asks for the boards again. */
export const OutMessage = defineMessageUnion({ RequestedBoards: {} })
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
        Effect.catch((error) =>
          Effect.succeed(
            Message.FailedStartTryOn({
              spent: Predicate.isTagged(error, 'LimitReached'),
              maybeOperationId: Predicate.isTagged(error, 'Unavailable') ? Option.some(operationId) : Option.none(),
            }),
          ),
        ),
      )
    }),
})

export const DeleteTryOn = Command.define('DeleteTryOn', {
  args: { tryOnId: TryOnId },
  messages: [Message.SucceededDeleteTryOn, Message.FailedDeleteTryOn],
  execute: ({ tryOnId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId()
      const api = yield* (yield* StyldClient).api
      yield* api.tryOn.deleteTryOn({ params: { tryOnId }, payload: { operationId } })
      return Message.SucceededDeleteTryOn({ tryOnId })
    }).pipe(Effect.catch(() => Effect.succeed(Message.FailedDeleteTryOn()))),
})

// UPDATE

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
  (model) => ({ model: modifyFields(model, { misses: () => 0 }) }),
  tryOnsCache(AsyncData.revalidateOrLoad),
  Update.refresh<Model, Message, Choices, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.choices),
    revalidate: AsyncData.revalidateOrLoad,
    write: (model: Model, choices: ChoicesData) => modifyFields(model, { choices: () => choices }),
    load: ListChoices(),
  }),
])

/** The try-ons as read, with any started here that the read did not have yet, newest first. */
const listed = (model: Model, tryOns: ReadonlyArray<TryOnContract>): Model => {
  const missing = Array.filter(model.added, (added) => !tryOns.some(({ id }) => id === added.id))
  return modifyFields(model, {
    tryOns: () => TryOnsData.Success({ data: [...missing, ...tryOns] }),
    added: () => missing,
    misses: () => 0,
  })
}

/** A fresh choice: the photo and pieces given, the photo's word that it shows the person kept from an earlier try-on
 * of it. */
const choosing = (model: Model, maybePhotoId: Option.Option<PhotoId>, pieceIds: ReadonlyArray<PieceId>): Screen =>
  Screen.New({
    maybePhotoId,
    pieceIds,
    thisIsMe: Option.exists(maybePhotoId, (photoId) => tryOnsOf(model).some((tryOn) => tryOn.photoId === photoId)),
    sending: Sending.Idle(),
  })

type Choosing = Extract<Screen, { readonly _tag: 'New' }>

/** A change to the choice being made; a choice that changed is a new try-on, so a lost answer's id is dropped. */
const chose = (model: Model, change: (screen: Choosing) => Screen): UpdateReturn => {
  const screen = model.screen
  return Screen.guards.New(screen) && !Sending.guards.Sending(screen.sending)
    ? { model: modifyFields(model, { screen: () => change(screen) }) }
    : { model }
}

/** The try-on asked for did not start: the choice stays, with why. */
const failedStart = (model: Model, sending: Sending): UpdateReturn => {
  const screen = model.screen
  return Screen.guards.New(screen)
    ? { model: modifyFields(model, { screen: () => Screen.New({ ...screen, sending }) }) }
    : { model }
}

const toggled = (pieceIds: ReadonlyArray<PieceId>, pieceId: PieceId) =>
  pieceIds.includes(pieceId)
    ? Array.filter(pieceIds, (id) => id !== pieceId)
    : pieceIds.length >= maximumTryOnPieces
      ? pieceIds
      : [...pieceIds, pieceId]

/** Try on: sent once the photo, a piece and the person's word are there. */
const started = (model: Model): UpdateReturn => {
  const screen = model.screen
  if (!Screen.guards.New(screen) || Sending.guards.Sending(screen.sending) || !screen.thisIsMe) return { model }
  return Option.match(screen.maybePhotoId, {
    onNone: () => ({ model }),
    onSome: (photoId) =>
      Array.isReadonlyArrayEmpty(screen.pieceIds)
        ? { model }
        : {
            model: modifyFields(model, { screen: () => Screen.New({ ...screen, sending: Sending.Sending() }) }),
            commands: [
              StartTryOn({
                photoId,
                pieceIds: screen.pieceIds,
                maybeOperationId: Sending.guards.Failed(screen.sending)
                  ? screen.sending.maybeOperationId
                  : Option.none(),
              }),
            ],
          },
  })
}

/** One try-on opened: its result first, and Save to board aimed at it. */
const opened = (model: Model, tryOnId: TryOnId): UpdateReturn => ({
  model: modifyFields(model, {
    screen: () => Screen.Open({ tryOnId, side: 'after' }),
    deletion: () => Deletion.Idle(),
    saveToBoard: () => SaveToBoard.init({ kind: 'tryOn', id: tryOnId }),
  }),
})

/** Before or after, on a phone. */
const turned = (model: Model, side: 'before' | 'after'): UpdateReturn => {
  const screen = model.screen
  return Screen.guards.Open(screen)
    ? { model: modifyFields(model, { screen: () => Screen.Open({ tryOnId: screen.tryOnId, side }) }) }
    : { model }
}

const deletionAt = (model: Model, deletion: Deletion): UpdateReturn => ({
  model: modifyFields(model, { deletion: () => deletion }),
})

const confirmDelete = (model: Model): UpdateReturn =>
  !Screen.guards.Open(model.screen) || Deletion.guards.Deleting(model.deletion)
    ? { model }
    : {
        model: modifyFields(model, { deletion: () => Deletion.Deleting() }),
        commands: [DeleteTryOn({ tryOnId: model.screen.tryOnId })],
      }

const deleted = (model: Model, tryOnId: TryOnId): UpdateReturn => ({
  model: modifyFields(model, {
    screen: () => Screen.List(),
    deletion: () => Deletion.Idle(),
    added: Array.filter((tryOn) => tryOn.id !== tryOnId),
    tryOns: (tryOns) =>
      Option.match(AsyncData.getData(tryOns), {
        onNone: () => tryOns,
        onSome: (data) => TryOnsData.Success({ data: Array.filter(data, (tryOn) => tryOn.id !== tryOnId) }),
      }),
  }),
})

const foldSaveToBoard = SaveToBoard.foldInto<Model, Message, OutMessage>(
  (message) => Message.GotSaveToBoardMessage({ message }),
  () => OutMessage.RequestedBoards(),
)

const reads = (model: Model) => ({
  SucceededListTryOns: ({ tryOns }: { readonly tryOns: ReadonlyArray<TryOnContract> }) => ({
    model: listed(model, tryOns),
  }),
  FailedListTryOns: () => ({
    model: modifyFields(model, {
      tryOns: (tryOns) => AsyncData.settle(tryOns, Result.fail('Unavailable' as const)),
      misses: Number.increment,
    }),
  }),
  SucceededListChoices: ({ choices }: { readonly choices: Choices }) => ({
    model: modifyFields(model, { choices: () => ChoicesData.Success({ data: choices }) }),
  }),
  FailedListChoices: () => ({
    model: modifyFields(model, {
      choices: (choices) => AsyncData.settle(choices, Result.fail('Unavailable' as const)),
    }),
  }),
  ClickedRetry: () => revisit(model),
  TickedTryOnsRefresh: () => tryOnsCache(AsyncData.revalidate)(model),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ...reads(model),
    ClickedNew: () => ({ model: modifyFields(model, { screen: () => choosing(model, Option.none(), []) }) }),
    ClickedBack: () => ({
      model: modifyFields(model, { screen: () => Screen.List(), deletion: () => Deletion.Idle() }),
    }),
    SelectedPhoto: ({ photoId }) =>
      chose(model, (screen) => {
        const fresh = choosing(model, Option.some(photoId), screen.pieceIds)
        return Screen.guards.New(fresh) ? Screen.New({ ...fresh, thisIsMe: fresh.thisIsMe || screen.thisIsMe }) : fresh
      }),
    ToggledPiece: ({ pieceId }) =>
      chose(model, (screen) =>
        Screen.New({ ...screen, pieceIds: toggled(screen.pieceIds, pieceId), sending: Sending.Idle() }),
      ),
    SelectedLook: ({ pieceIds }) =>
      chose(model, (screen) =>
        Screen.New({ ...screen, pieceIds: pieceIds.slice(0, maximumTryOnPieces), sending: Sending.Idle() }),
      ),
    ToggledThisIsMe: () =>
      chose(model, (screen) => Screen.New({ ...screen, thisIsMe: !screen.thisIsMe, sending: Sending.Idle() })),
    ClickedTryOn: () => started(model),
    SucceededStartTryOn: ({ tryOn }) =>
      opened(
        modifyFields(model, {
          added: (added) => [tryOn, ...added],
          tryOns: () => TryOnsData.Success({ data: [tryOn, ...tryOnsOf(model).filter(({ id }) => id !== tryOn.id)] }),
        }),
        tryOn.id,
      ),
    FailedStartTryOn: ({ spent, maybeOperationId }) => failedStart(model, Sending.Failed({ spent, maybeOperationId })),
    ClickedOpen: ({ tryOnId }) => opened(model, tryOnId),
    ClickedSide: ({ side }) => turned(model, side),
    ClickedTryAgain: ({ photoId, pieceIds }) => ({
      model: modifyFields(model, { screen: () => choosing(model, Option.some(photoId), pieceIds) }),
    }),
    ClickedDelete: () => deletionAt(model, Deletion.Confirming()),
    ClickedCancelDelete: () => deletionAt(model, Deletion.Idle()),
    ClickedConfirmDelete: () => confirmDelete(model),
    SucceededDeleteTryOn: ({ tryOnId }) => deleted(model, tryOnId),
    FailedDeleteTryOn: () => deletionAt(model, Deletion.Failed()),
    GotSaveToBoardMessage: (got) => foldSaveToBoard(model, got.message),
  })

// SUBSCRIPTION

/** The try-ons are asked for again while one is being drawn. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  tryOnsWhileMaking: pollWhilePending<Model, Message>({
    pendingIds: (model) =>
      tryOnsOf(model)
        .filter(isMaking)
        .map(({ id }) => id),
    misses: (model) => model.misses,
    tick: Message.TickedTryOnsRefresh(),
  }),
}))
