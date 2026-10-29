import { Category, Piece } from '@styld/protocol'
import { Duration, Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

export const Pieces = defineTaggedUnion({
  Loading: {},
  Loaded: { pieces: Schema.Array(Piece) },
  Failed: {},
})
export type Pieces = typeof Pieces.Type

export const Model = Schema.Struct({
  pieces: Pieces,
  /** The category chip that filters the grid; none shows every piece. */
  category: Schema.Option(Category),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ pieces: Pieces.Loading(), category: Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPieces: { pieces: Schema.Array(Piece) },
  FailedListPieces: {},
  ClickedCategory: { category: Schema.Option(Category) },
  ClickedRetry: {},
  ElapsedRefreshPause: {},
})
export type Message = typeof Message.Type

// COMMAND

/** A new photo is ready within seconds, so the page asks again this often while one is processing. */
const refreshPause = Duration.seconds(2)

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
export const WaitToRefresh = Command.define('WaitToRefresh', {
  messages: [Message.ElapsedRefreshPause],
  execute: Effect.sleep(refreshPause).pipe(Effect.as(Message.ElapsedRefreshPause())),
})

/** The Commands that open the page. */
export const load = () => [ListPieces()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const isProcessing = (piece: Piece) => piece.status === 'processing'

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListPieces: ({ pieces }) => ({
      model: modifyFields(model, { pieces: () => Pieces.Loaded({ pieces }) }),
      commands: pieces.some(isProcessing) ? [WaitToRefresh()] : [],
    }),
    // A failed refresh keeps the pieces already shown and stops asking.
    FailedListPieces: () =>
      Pieces.guards.Loaded(model.pieces)
        ? { model }
        : { model: modifyFields(model, { pieces: () => Pieces.Failed() }) },
    ClickedCategory: ({ category }) => ({ model: modifyFields(model, { category: () => category }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { pieces: () => Pieces.Loading() }), commands: [ListPieces()] }),
    ElapsedRefreshPause: () => ({ model, commands: [ListPieces()] }),
  })
