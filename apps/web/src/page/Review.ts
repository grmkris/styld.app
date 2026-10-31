import {
  CaptureId,
  Category,
  Colour,
  DetectionId,
  type Keep,
  OperationId,
  Subcategory,
  Tray as TrayContract,
} from '@styld/protocol'
import { Duration, Effect, Option, Record, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import { toggleColour } from './PieceFields.ts'

// MODEL

export const Tray = defineTaggedUnion({
  Loading: {},
  Loaded: { tray: TrayContract },
  Failed: {},
})
export type Tray = typeof Tray.Type

/** What the person decided about one found piece; it starts from the suggestion. */
export const Decision = Schema.Struct({
  keep: Schema.Boolean,
  category: Schema.Option(Category),
  subcategory: Schema.Option(Subcategory),
  colours: Schema.Array(Colour),
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
  tray: Tray,
  decisions: Schema.Record(Schema.String, Decision),
  /** The found piece being edited; the grid waits behind it. */
  editing: Schema.Option(Schema.String),
  saving: Saving,
  /** Captures being tried again or removed, and the ones whose last try or removal failed. */
  acting: Schema.Array(Schema.String),
  actionFailed: Schema.Array(Schema.String),
  /** A refresh is on its way, so a new read of the tray does not start a second one. */
  refreshing: Schema.Boolean,
  /** The last refresh failed: the tray shown may be out of date. */
  stale: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  tray: Tray.Loading(),
  decisions: {},
  editing: Option.none(),
  saving: Saving.Idle(),
  acting: [],
  actionFailed: [],
  refreshing: false,
  stale: false,
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadTray: { tray: TrayContract },
  FailedLoadTray: {},
  ClickedRetryLoad: {},
  ToggledKeep: { detectionId: Schema.String },
  ClickedEdit: { detectionId: Schema.String },
  ClickedDoneEditing: {},
  ChoseCategory: { category: Category },
  ChoseSubcategory: { subcategory: Schema.Option(Subcategory) },
  ToggledColour: { colour: Colour },
  UpdatedName: { value: Schema.String },
  ToggledUseOriginal: {},
  ClickedAdd: {},
  CompletedDrawOperationId: { operationId: Schema.String },
  SucceededReview: { count: Schema.Number },
  FailedReview: { retry: Schema.Literals(['same', 'fresh']) },
  ClickedRetryCapture: { captureId: Schema.String },
  ClickedRemoveCapture: { captureId: Schema.String },
  ClickedSplit: { detectionId: Schema.String },
  SucceededRefreshTray: { tray: TrayContract },
  FailedRefreshTray: {},
  SucceededCaptureAction: { captureId: Schema.String },
  FailedCaptureAction: { captureId: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ AddedPieces: { count: Schema.Number } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Pieces are usually found within seconds, so the tray asks again this often while any are. */
const refreshPause = Duration.seconds(2)

const readTray = Effect.gen(function* () {
  const api = yield* (yield* StyldClient).api
  return Message.SucceededLoadTray({ tray: yield* api.capture.tray() })
}).pipe(Effect.orElseSucceed(() => Message.FailedLoadTray()))

/** @internal Exported for its tests. */
export const LoadTray = Command.define('LoadTray', {
  messages: [Message.SucceededLoadTray, Message.FailedLoadTray],
  execute: readTray,
})

/** The tray again after a pause, while a capture is still being cut out.
 * @internal Exported for its tests. */
export const RefreshTray = Command.define('RefreshTray', {
  messages: [Message.SucceededRefreshTray, Message.FailedRefreshTray],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededRefreshTray({ tray: yield* api.capture.tray() })
  }).pipe(
    Effect.delay(refreshPause),
    Effect.orElseSucceed(() => Message.FailedRefreshTray()),
  ),
})

/** @internal Exported for its tests. */
export const DrawOperationId = Command.define('DrawOperationId', {
  messages: [Message.CompletedDrawOperationId],
  execute: Effect.gen(function* () {
    const operationId = yield* (yield* Crypto.Crypto).randomUUIDv4()
    return Message.CompletedDrawOperationId({ operationId })
  }).pipe(Effect.orDie),
})

const ReviewArgs = Schema.Struct({
  operationId: Schema.String,
  keep: Schema.Array(
    Schema.Struct({
      detectionId: Schema.String,
      category: Category,
      subcategory: Schema.Option(Subcategory),
      colours: Schema.Array(Colour),
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
          category: kept.category,
          ...Option.match(kept.subcategory, { onNone: () => ({}), onSome: (subcategory) => ({ subcategory }) }),
          ...(kept.colours.length === 0 ? {} : { colours: kept.colours }),
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
        CaptureNotFound: () => Effect.succeed(Message.FailedReview({ retry: 'fresh' })),
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
  ) => Effect.Effect<unknown, unknown>,
) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* act(api, { captureId: yield* Schema.decodeUnknownEffect(CaptureId)(captureId) })
  }).pipe(
    Effect.as(Message.SucceededCaptureAction({ captureId })),
    Effect.orElseSucceed(() => Message.FailedCaptureAction({ captureId })),
  )

/** @internal Exported for its tests. */
export const RetryCapture = Command.define('RetryCapture', {
  args: { captureId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ captureId }) => onCapture(captureId, (api, params) => api.capture.retry({ params })),
})

/** @internal Exported for its tests. */
export const RemoveCapture = Command.define('RemoveCapture', {
  args: { captureId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ captureId }) => onCapture(captureId, (api, params) => api.capture.remove({ params })),
})

/** Show each sighting of a piece on its own card again, keyed in the page's actions by the piece's id.
 * @internal Exported for its tests. */
export const SplitSightings = Command.define('SplitSightings', {
  args: { detectionId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ detectionId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.capture.split({ params: { detectionId: yield* Schema.decodeUnknownEffect(DetectionId)(detectionId) } })
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
  Tray.guards.Loaded(model.tray) ? model.tray.tray.captures.flatMap(({ detections }) => detections) : []

/** A new found piece starts as its suggestion says, ticked when the server offers it ticked. */
const suggested = (detection: TrayContract['captures'][number]['detections'][number]): Decision => ({
  keep: detection.preselected && detection.suggestion.category !== null,
  category: Option.fromNullishOr(detection.suggestion.category),
  subcategory: Option.fromNullishOr(detection.suggestion.subcategory),
  colours: detection.suggestion.colours,
  name: '',
  useOriginal: false,
})

const loaded = (model: Model, tray: TrayContract): UpdateReturn => {
  const decisions = Record.fromEntries(
    tray.captures
      .flatMap(({ detections }) => detections)
      .map((detection) => [detection.id, model.decisions[detection.id] ?? suggested(detection)] as const),
  )
  return polling(
    modifyFields(model, { tray: () => Tray.Loaded({ tray }), decisions: () => decisions, stale: () => false }),
  )
}

/** Ask again after a pause while a capture is still being cut out; one refresh at a time. */
const polling = (model: Model): UpdateReturn => {
  const processing =
    Tray.guards.Loaded(model.tray) && model.tray.tray.captures.some(({ status }) => status === 'processing')
  return processing && !model.refreshing
    ? { model: modifyFields(model, { refreshing: () => true }), commands: [RefreshTray()] }
    : { model }
}

/** The pieces that will be added: ticked, with a category. */
export const keptOf = (model: Model) =>
  detectionsOf(model).flatMap(({ id }) => {
    const decision = model.decisions[id]
    return decision?.keep === true && Option.isSome(decision.category)
      ? [{ id, decision, category: decision.category.value }]
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

/** Ticking a piece without a category opens it, so the person can say what it is. */
const toggled = (model: Model, detectionId: string): UpdateReturn => {
  const decision = model.decisions[detectionId]
  if (decision === undefined) return { model }
  if (!decision.keep && Option.isNone(decision.category))
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
        keep: kept.map(({ id, decision, category }) => ({
          detectionId: id,
          category,
          subcategory: decision.subcategory,
          colours: decision.colours,
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
  ChoseCategory: ({ category }: { readonly category: Category }) =>
    decide(model, (decision) => ({
      ...decision,
      category: Option.some(category),
      keep: true,
      // A shelf belongs to its category.
      subcategory: Option.contains(decision.category, category) ? decision.subcategory : Option.none(),
    })),
  ChoseSubcategory: ({ subcategory }: { readonly subcategory: Option.Option<Subcategory> }) =>
    decide(model, (decision) => ({ ...decision, subcategory })),
  ToggledColour: ({ colour }: { readonly colour: Colour }) =>
    decide(model, (decision) => ({ ...decision, colours: toggleColour(colour)(decision.colours) })),
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
      : {
          model: modifyFields(model, { saving: () => Saving.Failed({ operationId: Option.none() }) }),
          commands: [LoadTray()],
        },
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
  // A failed refresh keeps the tray already shown and stops asking.
  FailedLoadTray: (): UpdateReturn =>
    Tray.guards.Loaded(model.tray) ? { model } : { model: modifyFields(model, { tray: () => Tray.Failed() }) },
  ClickedRetryLoad: (): UpdateReturn => ({
    model: modifyFields(model, { tray: () => Tray.Loading() }),
    commands: [LoadTray()],
  }),
  SucceededRefreshTray: ({ tray }: { readonly tray: TrayContract }) =>
    loaded(modifyFields(model, { refreshing: () => false }), tray),
  // A failed refresh keeps the tray shown, says it may be out of date, and keeps asking.
  FailedRefreshTray: (): UpdateReturn => polling(modifyFields(model, { refreshing: () => false, stale: () => true })),
  ClickedRetryCapture: ({ captureId }: { readonly captureId: string }): UpdateReturn =>
    act(model, captureId, RetryCapture({ captureId })),
  ClickedRemoveCapture: ({ captureId }: { readonly captureId: string }): UpdateReturn =>
    act(model, captureId, RemoveCapture({ captureId })),
  // The split sightings come back as cards of their own; the piece open shows its first again.
  ClickedSplit: ({ detectionId }: { readonly detectionId: string }): UpdateReturn =>
    act(modifyFields(model, { editing: () => Option.none() }), detectionId, SplitSightings({ detectionId })),
  SucceededCaptureAction: ({ captureId }: { readonly captureId: string }): UpdateReturn => ({
    model: modifyFields(model, { acting: (acting) => acting.filter((id) => id !== captureId) }),
    commands: [LoadTray()],
  }),
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
