import { GarmentGroup, Piece, PieceType } from '@styld/protocol'
import { Duration, Effect, Option, Result, Schema, Stream } from 'effect'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** The person's pieces as last read. Pages that show them keep them on screen while they are asked for again. */
export const PiecesData = AsyncData.Schema(Schema.Array(Piece), Schema.Literal('Unavailable'))
export type PiecesData = typeof PiecesData.schema.Type

export const Model = Schema.Struct({
  pieces: PiecesData.schema,
  /** The group the grid shows, then one of its types; none shows every piece. */
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  /** Kept cut-outs with no clean picture yet, and how asking for theirs went. */
  undrawn: Schema.Number,
  backfill: Schema.Literals(['idle', 'sending', 'sent', 'failed']),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  pieces: AsyncData.Idle(),
  group: Option.none(),
  type: Option.none(),
  undrawn: 0,
  backfill: 'idle',
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPieces: { pieces: Schema.Array(Piece) },
  FailedListPieces: {},
  ClickedGroup: { group: Schema.Option(GarmentGroup) },
  ClickedType: { type: Schema.Option(PieceType) },
  ClickedRetry: {},
  TickedRefresh: {},
  CompletedCountUndrawn: { pieces: Schema.Number },
  ClickedDrawPictures: {},
  SucceededDrawPictures: {},
  FailedDrawPictures: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for its tests. */
export const ListPieces = Command.define('ListPieces', {
  messages: [Message.SucceededListPieces, Message.FailedListPieces],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { pieces } = yield* api.wardrobe.listPieces()
    return Message.SucceededListPieces({ pieces })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListPieces())),
})

/** @internal Exported for its tests. */
export const CountUndrawn = Command.define('CountUndrawn', {
  messages: [Message.CompletedCountUndrawn],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { pieces } = yield* api.capture.undrawnPictures()
    return Message.CompletedCountUndrawn({ pieces })
  }).pipe(Effect.orElseSucceed(() => Message.CompletedCountUndrawn({ pieces: 0 }))),
})

/** @internal Exported for its tests. */
export const DrawPictures = Command.define('DrawPictures', {
  messages: [Message.SucceededDrawPictures, Message.FailedDrawPictures],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* api.capture.drawPictures()
    return Message.SucceededDrawPictures()
  }).pipe(Effect.orElseSucceed(() => Message.FailedDrawPictures())),
})

/** The Commands that open the page for a page that keeps its own copy of the pieces. */
export const load = () => [ListPieces()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const piecesCache = (revalidate: (pieces: PiecesData) => Option.Option<PiecesData>) =>
  Update.refresh<Model, Message, ReadonlyArray<Piece>, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.pieces),
    revalidate,
    write: (model: Model, pieces: PiecesData) => modifyFields(model, { pieces: () => pieces }),
    load: ListPieces(),
  })

/** Opening a page that shows the pieces: those already here stay on screen while they are asked for again, a
 * first visit asks, and a request on its way is not repeated. */
export const revisit = piecesCache(AsyncData.revalidateOrLoad)
/** Asking again for pieces already here, such as while one is processing. */
const refresh = piecesCache(AsyncData.revalidate)

/** Opening the wardrobe page itself: its pieces, and how many have no clean picture yet. */
export const enter = (model: Model): UpdateReturn => {
  const opened = revisit(model)
  return { ...opened, commands: [...(opened.commands ?? []), CountUndrawn()] }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListPieces: ({ pieces }) => ({
      model: modifyFields(model, { pieces: () => PiecesData.Success({ data: pieces }) }),
    }),
    // A failed refresh keeps the pieces already shown.
    FailedListPieces: () => ({
      model: modifyFields(model, { pieces: (pieces) => AsyncData.settle(pieces, Result.fail('Unavailable' as const)) }),
    }),
    // Another group starts from all of its types.
    ClickedGroup: ({ group }) => ({ model: modifyFields(model, { group: () => group, type: () => Option.none() }) }),
    ClickedType: ({ type }) => ({ model: modifyFields(model, { type: () => type }) }),
    ClickedRetry: () => revisit(model),
    TickedRefresh: () => refresh(model),
    CompletedCountUndrawn: ({ pieces }) => ({ model: modifyFields(model, { undrawn: () => pieces }) }),
    ClickedDrawPictures: () =>
      model.backfill === 'sending'
        ? { model }
        : { model: modifyFields(model, { backfill: () => 'sending' as const }), commands: [DrawPictures()] },
    // The pieces are read again, so each shows its drawing on its way.
    SucceededDrawPictures: () => refresh(modifyFields(model, { undrawn: () => 0, backfill: () => 'sent' as const })),
    FailedDrawPictures: () => ({ model: modifyFields(model, { backfill: () => 'failed' as const }) }),
  })

// SUBSCRIPTION

/** A new photo is ready within seconds, so the pieces are asked for again this often while one is processing. */
const refreshPause = Duration.seconds(2)

/** Whether a piece is still processing or its clean picture is being drawn. */
const isProcessing = (pieces: PiecesData) =>
  AsyncData.getData(pieces).pipe(
    Option.exists((list) => list.some((piece) => piece.status === 'processing' || piece.picture?.state === 'drawing')),
  )

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  refreshWhileProcessing: entry(
    { isActive: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isActive: isProcessing(model.pieces) }),
      dependenciesToStream: ({ isActive }) =>
        Stream.when(
          Stream.tick(refreshPause).pipe(Stream.drop(1), Stream.map(Message.TickedRefresh)),
          Effect.sync(() => isActive),
        ),
    },
  ),
}))
