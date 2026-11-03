import { drawOperationId } from '../OperationIds.ts'
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
import * as SecureRandom from 'effect/crypto/SecureRandom'
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

/** Adding the kept pieces. A failure whose answer may have been lost keeps the operation id it was sent under, so the
 * retry repeats it and the pieces are made once. */
export const Saving = defineTaggedUnion({
  Idle: {},
  Saving: {},
  Failed: { maybeOperationId: Schema.Option(OperationId) },
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
  SucceededReview: { count: Schema.Number },
  FailedReview: { maybeOperationId: Schema.Option(OperationId) },
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

export const LoadTray = Command.define('LoadTray', {
  messages: [Message.SucceededLoadTray, Message.FailedLoadTray],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededLoadTray({ tray: yield* api.capture.tray() })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadTray())),
})

const ReviewArgs = Schema.Struct({
  maybeOperationId: Schema.Option(OperationId),
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

/** Add the kept pieces and drop the rest, under a new operation id or the one a lost answer had. */
export const SendReview = Command.define('SendReview', {
  args: ReviewArgs.fields,
  messages: [Message.SucceededReview, Message.FailedReview],
  execute: (args) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(args.maybeOperationId)
      const sent = Effect.gen(function* () {
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
            operationId,
            keep,
            discard: yield* Effect.forEach(args.discard, (id) => Schema.decodeUnknownEffect(DetectionId)(id)),
          },
        })
        return Message.SucceededReview({ count: reviewed.pieceIds.length })
      })
      return yield* sent.pipe(
        // Pieces someone already decided, or a reused operation id, cannot succeed as sent: the tray is read again.
        Effect.catchTags({
          NotFound: () => Effect.succeed(Message.FailedReview({ maybeOperationId: Option.none() })),
          OperationConflict: () => Effect.succeed(Message.FailedReview({ maybeOperationId: Option.none() })),
        }),
        Effect.orElseSucceed(() => Message.FailedReview({ maybeOperationId: Option.some(operationId) })),
      )
    }),
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
    yield* act(api, { captureId: yield* Schema.decodeUnknownEffect(CaptureId)(captureId) }, yield* drawOperationId())
  }).pipe(
    Effect.as(Message.SucceededCaptureAction({ captureId })),
    Effect.orElseSucceed(() => Message.FailedCaptureAction({ captureId })),
  )

export const RetryCapture = Command.define('RetryCapture', {
  args: { captureId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ captureId }) =>
    onCapture(captureId, (api, params, operationId) => api.capture.retry({ params, payload: { operationId } })),
})

export const RemoveCapture = Command.define('RemoveCapture', {
  args: { captureId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ captureId }) =>
    onCapture(captureId, (api, params, operationId) => api.capture.remove({ params, payload: { operationId } })),
})

/** Show each sighting of a piece on its own card again, keyed in the page's actions by the piece's id.
 */
export const SplitSightings = Command.define('SplitSightings', {
  args: { detectionId: Schema.String },
  messages: [Message.SucceededCaptureAction, Message.FailedCaptureAction],
  execute: ({ detectionId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.capture.split({
        params: { detectionId: yield* Schema.decodeUnknownEffect(DetectionId)(detectionId) },
        payload: { operationId: yield* drawOperationId() },
      })
    }).pipe(
      Effect.as(Message.SucceededCaptureAction({ captureId: detectionId })),
      Effect.orElseSucceed(() => Message.FailedCaptureAction({ captureId: detectionId })),
    ),
})

/** The Commands that open the page. */
export const load = () => [LoadTray()]

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

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
const send = (model: Model, maybeOperationId: Option.Option<OperationId>): UpdateReturn => {
  const kept = keptOf(model)
  const keptIds = new Set(kept.map(({ id }) => id))
  return {
    model: modifyFields(model, { saving: () => Saving.Saving() }),
    commands: [
      SendReview({
        maybeOperationId,
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
    Idle: () => send(model, Option.none()),
    Failed: ({ maybeOperationId }) => send(model, maybeOperationId),
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
  SucceededReview: ({ count }: { readonly count: number }): UpdateReturn => ({
    model: modifyFields(model, { saving: () => Saving.Idle() }),
    outMessage: OutMessage.AddedPieces({ count }),
  }),
  // A lost answer keeps the operation id for the retry; a refusal (pieces decided elsewhere) reads the tray again.
  FailedReview: ({ maybeOperationId }: { readonly maybeOperationId: Option.Option<OperationId> }): UpdateReturn => {
    const failed = modifyFields(model, { saving: () => Saving.Failed({ maybeOperationId }) })
    return Option.isSome(maybeOperationId) ? { model: failed } : readAgain(failed)
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
