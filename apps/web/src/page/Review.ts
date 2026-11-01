import { newOperation, newOperationId } from '../OperationIds.ts'
import {
  CaptureId,
  Colour,
  DetectionId,
  type Keep,
  Occasion,
  OperationId,
  Pattern,
  PieceType,
  Season,
  Tray as TrayContract,
} from '@styld/protocol'
import { Effect, Number, Option, Record, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Misses, pollWhilePending } from '../Polling.ts'
import { StyldClient } from '../StyldClient.ts'
import { changeDetails, Details, detailsOf, detailsPayload } from './PieceFields.ts'

// MODEL

/** The review tray as last read; a failed read keeps what was shown. */
export const TrayData = AsyncData.Schema(TrayContract, Schema.Literal('Unavailable'))
export type TrayData = typeof TrayData.schema.Type

/** What the person decided about one found piece; it starts from the suggestion. */
export const Decision = Schema.Struct({
  keep: Schema.Boolean,
  details: Details,
  name: Schema.String,
  useOriginal: Schema.Boolean,
})
export type Decision = typeof Decision.Type

/** Adding the kept pieces. A retry repeats the operation id, so the pieces are made once. */
export const Saving = defineTaggedUnion({
  Idle: {},
  Preparing: {},
  Saving: { operationId: Schema.String },
  Failed: { operationId: Schema.Option(Schema.String) },
})
export type Saving = typeof Saving.Type

export const Model = Schema.Struct({
  tray: TrayData.schema,
  decisions: Schema.Record(Schema.String, Decision),
  /** The found piece being edited; the grid waits behind it. */
  editing: Schema.Option(Schema.String),
  saving: Saving,
  /** Captures being tried again or removed, and the ones whose last try or removal failed. */
  acting: Schema.Array(Schema.String),
  actionFailed: Schema.Array(Schema.String),
  misses: Misses,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  tray: AsyncData.Loading(),
  decisions: {},
  editing: Option.none(),
  saving: Saving.Idle(),
  acting: [],
  actionFailed: [],
  misses: 0,
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadTray: { tray: TrayContract },
  FailedLoadTray: {},
  ClickedRetryLoad: {},
  ToggledKeep: { detectionId: Schema.String },
  ClickedEdit: { detectionId: Schema.String },
  ClickedDoneEditing: {},
  ChoseType: { type: PieceType },
  ToggledColour: { colour: Colour },
  ChoseSeason: { season: Season },
  ToggledOccasion: { occasion: Occasion },
  ChosePattern: { pattern: Pattern },
  UpdatedName: { value: Schema.String },
  ToggledUseOriginal: {},
  ClickedAdd: {},
  CompletedDrawOperationId: { operationId: Schema.String },
  SucceededReview: { count: Schema.Number },
  FailedReview: { retry: Schema.Literals(['same', 'fresh']) },
  ClickedRetryCapture: { captureId: Schema.String },
  ClickedRemoveCapture: { captureId: Schema.String },
  ClickedSplit: { detectionId: Schema.String },
  TickedTrayRefresh: {},
  SucceededCaptureAction: { captureId: Schema.String },
  FailedCaptureAction: { captureId: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ AddedPieces: { count: Schema.Number } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** @internal Exported for its tests. */
export const LoadTray = Command.define('LoadTray', {
  messages: [Message.SucceededLoadTray, Message.FailedLoadTray],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededLoadTray({ tray: yield* api.capture.tray() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadTray())),
})

/** @internal Exported for its tests. */
export const DrawOperationId = Command.define('DrawOperationId', {
  messages: [Message.CompletedDrawOperationId],
  execute: Effect.map(newOperationId, (operationId) => Message.CompletedDrawOperationId({ operationId })),
})

const ReviewArgs = Schema.Struct({
  operationId: Schema.String,
  keep: Schema.Array(
    Schema.Struct({
      detectionId: Schema.String,
      type: PieceType,
      details: Details,
      name: Schema.Option(Schema.String),
      useOriginal: Schema.Boolean,
    }),
  ),
  discard: Schema.Array(Schema.String),
})

/** @internal Exported for its tests. */
export const SendReview = Command.define('SendReview', {
  args: ReviewArgs.fields,
  messages: [Message.SucceededReview, Message.FailedReview],
  execute: (args) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const keep = yield* Effect.forEach(args.keep, (kept) =>
        Effect.map(Schema.decodeUnknownEffect(DetectionId)(kept.detectionId), (detectionId): Keep => ({
          detectionId,
          type: kept.type,
          ...detailsPayload(kept.details),
          ...Option.match(kept.name, { onNone: () => ({}), onSome: (name) => ({ name }) }),
          ...(kept.useOriginal ? { useOriginal: true } : {}),
        })),
      )
      const reviewed = yield* api.capture.review({
        payload: {
          operationId: yield* Schema.decodeUnknownEffect(OperationId)(args.operationId),
          keep,
          discard: yield* Effect.forEach(args.discard, (id) => Schema.decodeUnknownEffect(DetectionId)(id)),
        },
      })
      return Message.SucceededReview({ count: reviewed.pieceIds.length })
    }).pipe(
      // Pieces someone already decided, or a reused operation id, cannot succeed as sent: the tray is read again.
      Effect.catchTags({
        NotFound: () => Effect.succeed(Message.FailedReview({ retry: 'fresh' })),
        OperationConflict: () => Effect.succeed(Message.FailedReview({ retry: 'fresh' })),
      }),
      Effect.orElseSucceed(() => Message.FailedReview({ retry: 'same' })),
    ),
})

/** Ask the API to act on one capture, and say whether it did. */
const onCapture = (
  captureId: string,
  act: (
    api: Effect.Success<StyldClient['Service']['api']>,
    params: { readonly captureId: CaptureId },
    operationId: OperationId,
  ) => Effect.Effect<unknown, unknown>,
) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* act(api, { captureId: yield* Schema.decodeUnknownEffect(CaptureId)(captureId) }, yield* newOperationId)
  }).pipe(
    Effect.as(Message.SucceededCaptureAction({ captureId })),
    Effect.orElseSucceed(() => Message.FailedCaptureAction({ captureId })),
  )

/** @internal Exported for its tests. */
export const RetryCapture = Command.define('RetryCapture', {
  args: { captureId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ captureId }) =>
    onCapture(captureId, (api, params, operationId) => api.capture.retry({ params, payload: { operationId } })),
})

/** @internal Exported for its tests. */
export const RemoveCapture = Command.define('RemoveCapture', {
  args: { captureId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ captureId }) =>
    onCapture(captureId, (api, params, operationId) => api.capture.remove({ params, payload: { operationId } })),
})

/** Show each sighting of a piece on its own card again, keyed in the page's actions by the piece's id.
 * @internal Exported for its tests. */
export const SplitSightings = Command.define('SplitSightings', {
  args: { detectionId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ detectionId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.capture.split({
        params: { detectionId: yield* Schema.decodeUnknownEffect(DetectionId)(detectionId) },
        payload: yield* newOperation,
      })
    }).pipe(
      Effect.as(Message.SucceededCaptureAction({ captureId: detectionId })),
      Effect.orElseSucceed(() => Message.FailedCaptureAction({ captureId: detectionId })),
    ),
})

/** The Commands that open the page. */
export const load = () => [LoadTray()]

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

/** Every found piece the tray shows, in the order it shows them. */
const detectionsOf = (model: Model) =>
  Option.match(AsyncData.getData(model.tray), {
    onNone: () => [],
    onSome: (tray) => tray.captures.flatMap(({ detections }) => detections),
  })

/** A new found piece starts as its suggestion says, ticked when the server offers it ticked. */
const suggested = (detection: TrayContract['captures'][number]['detections'][number]): Decision => ({
  keep: detection.preselected && detection.suggestion.type !== null,
  details: detailsOf(detection.suggestion),
  name: '',
  useOriginal: false,
})

/** A read of the tray: what it shows, with each found piece's decision kept as the person left it and a new one
 * starting from its suggestion. The page's own work (an edit, adding, a capture's action) is left as it is. */
const loaded = (model: Model, tray: TrayContract): UpdateReturn => {
  const decisions = Record.fromEntries(
    tray.captures
      .flatMap(({ detections }) => detections)
      .map((detection) => [detection.id, model.decisions[detection.id] ?? suggested(detection)] as const),
  )
  return {
    model: modifyFields(model, {
      tray: () => TrayData.Success({ data: tray }),
      decisions: () => decisions,
      misses: () => 0,
    }),
  }
}

const trayCache = (revalidate: (tray: TrayData) => Option.Option<TrayData>) =>
  Update.refresh<Model, Message, TrayContract, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.tray),
    revalidate,
    write: (model: Model, tray: TrayData) => modifyFields(model, { tray: () => tray }),
    load: LoadTray(),
  })

/** The tray read again after a change made here, even with a poll on its way: that poll may predate the change. */
const readAgain = (model: Model): UpdateReturn => ({
  model: modifyFields(model, {
    tray: (tray) => Option.getOrElse(AsyncData.revalidate(tray), () => tray),
  }),
  commands: [LoadTray()],
})

/** The pieces that will be added: ticked, with a type. */
export const keptOf = (model: Model) =>
  detectionsOf(model).flatMap(({ id }) => {
    const decision = model.decisions[id]
    return decision?.keep === true && Option.isSome(decision.details.type)
      ? [{ id, decision, type: decision.details.type.value }]
      : []
  })

const decide = (model: Model, change: (decision: Decision) => Decision): UpdateReturn =>
  Option.match(model.editing, {
    onNone: () => ({ model }),
    onSome: (id) => {
      const decision = model.decisions[id]
      return decision === undefined
        ? { model }
        : { model: modifyFields(model, { decisions: (decisions) => ({ ...decisions, [id]: change(decision) }) }) }
    },
  })

const changed = (model: Model, change: (details: Details) => Details): UpdateReturn =>
  decide(model, (decision) => ({ ...decision, details: change(decision.details) }))

/** Ticking a piece without a type opens it, so the person can say what it is. */
const toggled = (model: Model, detectionId: string): UpdateReturn => {
  const decision = model.decisions[detectionId]
  if (decision === undefined) return { model }
  if (!decision.keep && Option.isNone(decision.details.type))
    return { model: modifyFields(model, { editing: () => Option.some(detectionId) }) }
  return {
    model: modifyFields(model, {
      decisions: (decisions) => ({ ...decisions, [detectionId]: { ...decision, keep: !decision.keep } }),
    }),
  }
}

/** The name the person typed, if any. */
const givenName = (value: string) => (value.trim().length === 0 ? Option.none() : Option.some(value.trim()))

/** Send the decisions: kept pieces, and every other piece shown discarded. */
const send = (model: Model, operationId: string): UpdateReturn => {
  const kept = keptOf(model)
  const keptIds = new Set(kept.map(({ id }) => id))
  return {
    model: modifyFields(model, { saving: () => Saving.Saving({ operationId }) }),
    commands: [
      SendReview({
        operationId,
        keep: kept.map(({ id, decision, type }) => ({
          detectionId: id,
          type,
          details: decision.details,
          name: givenName(decision.name),
          useOriginal: decision.useOriginal,
        })),
        discard: detectionsOf(model)
          .map(({ id }) => id)
          .filter((id) => !keptIds.has(id)),
      }),
    ],
  }
}

const clickedAdd = (model: Model): UpdateReturn => {
  if (keptOf(model).length === 0) return { model }
  return Saving.match(model.saving, {
    Idle: () => ({ model: modifyFields(model, { saving: () => Saving.Preparing() }), commands: [DrawOperationId()] }),
    Failed: ({ operationId }) =>
      Option.match(operationId, {
        onNone: () => ({
          model: modifyFields(model, { saving: () => Saving.Preparing() }),
          commands: [DrawOperationId()],
        }),
        onSome: (id) => send(model, id),
      }),
    Preparing: () => ({ model }),
    Saving: () => ({ model }),
  })
}

/** Changing the found piece that is open. */
const editHandlers = (model: Model) => ({
  ClickedEdit: ({ detectionId }: { readonly detectionId: string }): UpdateReturn => ({
    model: modifyFields(model, { editing: () => Option.some(detectionId) }),
  }),
  ClickedDoneEditing: (): UpdateReturn => ({ model: modifyFields(model, { editing: () => Option.none() }) }),
  // Saying what it is keeps it.
  ChoseType: ({ type }: { readonly type: PieceType }) =>
    decide(model, (decision) => ({ ...decision, details: changeDetails.type(type)(decision.details), keep: true })),
  ToggledColour: ({ colour }: { readonly colour: Colour }) => changed(model, changeDetails.colour(colour)),
  ChoseSeason: ({ season }: { readonly season: Season }) => changed(model, changeDetails.season(season)),
  ToggledOccasion: ({ occasion }: { readonly occasion: Occasion }) => changed(model, changeDetails.occasion(occasion)),
  ChosePattern: ({ pattern }: { readonly pattern: Pattern }) => changed(model, changeDetails.pattern(pattern)),
  UpdatedName: ({ value }: { readonly value: string }) => decide(model, (decision) => ({ ...decision, name: value })),
  ToggledUseOriginal: () => decide(model, (decision) => ({ ...decision, useOriginal: !decision.useOriginal })),
})

/** Adding the kept pieces, and what the server answered. */
const savingHandlers = (model: Model) => ({
  ToggledKeep: ({ detectionId }: { readonly detectionId: string }) => toggled(model, detectionId),
  ClickedAdd: () => clickedAdd(model),
  CompletedDrawOperationId: ({ operationId }: { readonly operationId: string }): UpdateReturn =>
    Saving.guards.Preparing(model.saving) ? send(model, operationId) : { model },
  SucceededReview: ({ count }: { readonly count: number }): UpdateReturn => ({
    model: modifyFields(model, { saving: () => Saving.Idle() }),
    outMessage: OutMessage.AddedPieces({ count }),
  }),
  // A retry worth repeating keeps the operation id; pieces decided elsewhere send the tray to be read again.
  FailedReview: ({ retry }: { readonly retry: 'same' | 'fresh' }): UpdateReturn =>
    retry === 'same'
      ? {
          model: modifyFields(model, {
            saving: (saving) =>
              Saving.Failed({
                operationId: Saving.guards.Saving(saving) ? Option.some(saving.operationId) : Option.none(),
              }),
          }),
        }
      : readAgain(modifyFields(model, { saving: () => Saving.Failed({ operationId: Option.none() }) })),
})

/** Try a capture again, remove it, or split a piece's sightings, once at a time for each. */
const act = (
  model: Model,
  captureId: string,
  command: ReturnType<typeof RetryCapture> | ReturnType<typeof RemoveCapture> | ReturnType<typeof SplitSightings>,
): UpdateReturn =>
  model.acting.includes(captureId)
    ? { model }
    : {
        model: modifyFields(model, {
          acting: (acting) => [...acting, captureId],
          actionFailed: (failed) => failed.filter((id) => id !== captureId),
        }),
        commands: [command],
      }

/** Reading the tray, and trying a capture again or removing it. */
const trayHandlers = (model: Model) => ({
  SucceededLoadTray: ({ tray }: { readonly tray: TrayContract }) => loaded(model, tray),
  // A failed read keeps the tray shown, which says it may be out of date; polls go on up to five misses.
  FailedLoadTray: (): UpdateReturn => ({
    model: modifyFields(model, {
      tray: (tray) => AsyncData.settle(tray, Result.fail('Unavailable' as const)),
      misses: Number.increment,
    }),
  }),
  ClickedRetryLoad: (): UpdateReturn => trayCache(AsyncData.revalidateOrLoad)(modifyFields(model, { misses: () => 0 })),
  TickedTrayRefresh: (): UpdateReturn => trayCache(AsyncData.revalidate)(model),
  ClickedRetryCapture: ({ captureId }: { readonly captureId: string }): UpdateReturn =>
    act(model, captureId, RetryCapture({ captureId })),
  ClickedRemoveCapture: ({ captureId }: { readonly captureId: string }): UpdateReturn =>
    act(model, captureId, RemoveCapture({ captureId })),
  // The split sightings come back as cards of their own; the piece open shows its first again.
  ClickedSplit: ({ detectionId }: { readonly detectionId: string }): UpdateReturn =>
    act(modifyFields(model, { editing: () => Option.none() }), detectionId, SplitSightings({ detectionId })),
  SucceededCaptureAction: ({ captureId }: { readonly captureId: string }): UpdateReturn =>
    readAgain(modifyFields(model, { acting: (acting) => acting.filter((id) => id !== captureId) })),
  FailedCaptureAction: ({ captureId }: { readonly captureId: string }): UpdateReturn => ({
    model: modifyFields(model, {
      acting: (acting) => acting.filter((id) => id !== captureId),
      actionFailed: (failed) => [...failed, captureId],
    }),
  }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ...trayHandlers(model),
    ...editHandlers(model),
    ...savingHandlers(model),
  })

// SUBSCRIPTION

/** The captures still being cut out, which the tray waits on. */
const processingIds = (model: Model): ReadonlyArray<string> =>
  Option.match(AsyncData.getData(model.tray), {
    onNone: () => [],
    onSome: (tray) => tray.captures.filter(({ status }) => status === 'processing').map(({ id }) => id),
  })

/** The tray is asked for again while a capture is still being cut out. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
  trayWhileProcessing: pollWhilePending<Model, Message>({
    pendingIds: processingIds,
    misses: (model) => model.misses,
    tick: Message.TickedTrayRefresh(),
  }),
}))
