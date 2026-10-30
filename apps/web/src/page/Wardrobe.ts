import { Category, Piece } from '@styld/protocol'
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
  /** The category chip that filters the grid; none shows every piece. */
  category: Schema.Option(Category),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ pieces: AsyncData.Idle(), category: Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPieces: { pieces: Schema.Array(Piece) },
  FailedListPieces: {},
  ClickedCategory: { category: Schema.Option(Category) },
  ClickedRetry: {},
  TickedRefresh: {},
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

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListPieces: ({ pieces }) => ({
      model: modifyFields(model, { pieces: () => PiecesData.Success({ data: pieces }) }),
    }),
    // A failed refresh keeps the pieces already shown.
    FailedListPieces: () => ({
      model: modifyFields(model, { pieces: (pieces) => AsyncData.settle(pieces, Result.fail('Unavailable' as const)) }),
    }),
    ClickedCategory: ({ category }) => ({ model: modifyFields(model, { category: () => category }) }),
    ClickedRetry: () => revisit(model),
    TickedRefresh: () => refresh(model),
  })

// SUBSCRIPTION

/** A new photo is ready within seconds, so the pieces are asked for again this often while one is processing. */
const refreshPause = Duration.seconds(2)

const isProcessing = (pieces: PiecesData) =>
  AsyncData.getData(pieces).pipe(Option.exists((list) => list.some((piece) => piece.status === 'processing')))

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
