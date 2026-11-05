import {
  type Board,
  type BoardImageId,
  type BoardItem,
  BoardItemId,
  ImageItem,
  maximumLookPieces,
  type Paper,
  PieceId,
  PieceItem,
  landing,
  piecesOnTable,
  settle,
  toggledLayer,
  TextItem,
  type TextStyle,
  topZ,
} from '@styld/protocol'
import { Array, Option, Result, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { AddImage, SaveLook, UpdatePaper, WaitForExit, WaitForToast } from './Commands.ts'
import { committed, findItem, refillIds, takeId, type UpdateReturn, withItem } from './Edits.ts'
import {
  BoardData,
  BoardShown,
  LookSave,
  type Model,
  ownBoard,
  Ticks,
  Toast,
  Upload,
  type UploadProblem,
  withChecked,
} from './Model.ts'

/** The most pictures one paste or drop sends at once. */
const picturesAtOnce = 4

const itemIdOf = (id: string) => Schema.decodeUnknownSync(BoardItemId)(id)

/** Put a new item on the table with the next fresh id and select it. */
const added = (model: Model, make: (id: BoardItemId) => BoardItem): UpdateReturn =>
  Option.match(takeId(model), {
    onNone: () => ({ model }),
    onSome: ({ id, model: next, refill }) => {
      const item = make(itemIdOf(id))
      const addition = committed(
        modifyFields(next, { maybeSelectedId: () => Option.some(item.id) }),
        model.items,
        Array.append(model.items, item),
      )
      return { model: addition.model, commands: [...(addition.commands ?? []), ...refillIds(refill)] }
    },
  })

export const addedPiece = (model: Model, pieceId: string): UpdateReturn => {
  const onTable = Array.filter(model.items, (item) => Schema.is(PieceItem)(item) && item.pieceId === pieceId)
  return Array.match(onTable, {
    onEmpty: () =>
      added(model, (id) =>
        PieceItem.make({ id, pieceId: Schema.decodeUnknownSync(PieceId)(pieceId), ...landing(model.items, 380) }),
      ),
    onNonEmpty: ([first]) => ({ model: modifyFields(model, { maybeSelectedId: () => Option.some(first.id) }) }),
  })
}

/** A look's pieces on the table, as one undo step: those already there stay where they are, and the first new one is
 * selected. */
export const addedPieces = (model: Model, pieceIds: ReadonlyArray<string>): UpdateReturn => {
  const onTable = new Set<string>(piecesOnTable(model.items))
  const fresh = Array.dedupe(pieceIds.filter((pieceId) => !onTable.has(pieceId)))
  const placed = Array.reduce(fresh, { model, items: model.items, refill: false }, (state, pieceId) =>
    Option.match(takeId(state.model), {
      onNone: () => state,
      onSome: ({ id, model: next, refill }) => ({
        model: next,
        refill: state.refill || refill,
        items: Array.append(
          state.items,
          PieceItem.make({
            id: itemIdOf(id),
            pieceId: Schema.decodeUnknownSync(PieceId)(pieceId),
            ...landing(state.items, 380),
          }),
        ),
      }),
    }),
  )
  const first = Array.get(placed.items, model.items.length)
  const addition = committed(
    modifyFields(placed.model, { maybeSelectedId: () => Option.map(first, (item) => item.id) }),
    model.items,
    placed.items,
  )
  return { model: addition.model, commands: [...(addition.commands ?? []), ...refillIds(placed.refill)] }
}

export const addedText = (model: Model, text: string): UpdateReturn =>
  // A label lands across the middle: words run wider than a piece.
  added(model, (id) => TextItem.make({ id, text, style: 'label', ...landing(model.items, 360), x: 500 }))

/** One picture settled, as `problem` says: the rest stay on their way, and once none is, a failure among them shows. */
const pictureSettled = (upload: Upload, problem: Option.Option<UploadProblem>): Upload => {
  const sending = Upload.guards.Sending(upload) ? upload.count - 1 : 0
  const worst = Option.orElse(problem, () => (Upload.guards.Sending(upload) ? upload.problem : Option.none()))
  if (sending > 0) return Upload.Sending({ count: sending, problem: worst })
  return Option.match(worst, { onNone: () => Upload.Idle(), onSome: (failed) => Upload.Failed({ problem: failed }) })
}

export const addedImage = (
  model: Model,
  imageId: BoardImageId,
  image?: { readonly thumb: string; readonly full: string },
): UpdateReturn =>
  added(modifyFields(model, { upload: (upload) => pictureSettled(upload, Option.none()) }), (id) =>
    ImageItem.make({ id, imageId, ...(image === undefined ? {} : { image }), ...landing(model.items, 420) }),
  )

/** A picture that did not reach the board leaves the others on their way. */
export const imageFailed = (model: Model, problem: UploadProblem): UpdateReturn => ({
  model: modifyFields(model, { upload: (upload) => pictureSettled(upload, Option.some(problem)) }),
})

/** A picture pinned on the board goes back on the table. */
export const placedPicture = (model: Model, imageId: BoardImageId): UpdateReturn =>
  added(model, (id) => ImageItem.make({ id, imageId, ...landing(model.items, 420) }))

/** Change one item and keep it selected, as one undo step. */
const changed = (model: Model, id: string, change: (item: BoardItem) => BoardItem): UpdateReturn =>
  Option.match(findItem(model.items, id), {
    onNone: () => ({ model }),
    onSome: (item) => committed(model, model.items, withItem(model.items, change(item))),
  })

export const flipped = (model: Model, id: string) => changed(model, id, (item) => ({ ...item, flipped: !item.flipped }))

export const textUpdated = (model: Model, id: string, text: string) =>
  text.trim().length === 0
    ? { model }
    : changed(model, id, (item) => (Schema.is(TextItem)(item) ? { ...item, text } : item))

export const styleSelected = (model: Model, id: string, style: TextStyle) =>
  changed(model, id, (item) => (Schema.is(TextItem)(item) ? { ...item, style } : item))

export const layered = (model: Model, id: string) => committed(model, model.items, toggledLayer(model.items, id))

export const duplicated = (model: Model, id: string): UpdateReturn =>
  Option.match(findItem(model.items, id), {
    onNone: () => ({ model }),
    onSome: (item) =>
      added(model, (newId) => settle({ ...item, id: newId, x: item.x + 40, y: item.y + 40, z: topZ(model.items) + 1 })),
  })

/** Take an item off: it plays its exit, and "Removed. Undo" offers the table back for a few seconds. */
export const removed = (model: Model, id: string): UpdateReturn =>
  Option.match(findItem(model.items, id), {
    onNone: () => ({ model }),
    onSome: (item) => {
      const generation = model.generation + 1
      const removal = committed(
        modifyFields(model, {
          leaving: (leaving) => Array.append(leaving, item),
          maybeSelectedId: () => Option.none(),
          toast: () => Toast.Removed({ generation, before: model.items }),
          generation: () => generation,
        }),
        model.items,
        Array.filter(model.items, (other) => other.id !== id),
      )
      return {
        model: removal.model,
        commands: [...(removal.commands ?? []), WaitForExit({ id }), WaitForToast({ generation })],
      }
    },
  })

export const undoRemove = (model: Model): UpdateReturn =>
  Toast.match(model.toast, {
    Hidden: () => ({ model }),
    Removed: ({ before }) => committed(modifyFields(model, { toast: () => Toast.Hidden() }), model.items, before),
  })

export const toastElapsed = (model: Model, generation: number): UpdateReturn =>
  Toast.guards.Removed(model.toast) && model.toast.generation === generation
    ? { model: modifyFields(model, { toast: () => Toast.Hidden() }) }
    : { model }

export const exited = (model: Model, id: string): UpdateReturn => ({
  model: modifyFields(model, { leaving: (leaving) => Array.filter(leaving, (item) => item.id !== id) }),
})

/** The board shown with another paper. */
const withPaper = (model: Model, name: string, paper: Paper): Model =>
  modifyFields(model, { board: () => BoardData.Success({ data: BoardShown.Own({ name, paper }) }) })

/** A paper shows at once and is saved behind; the one it replaced comes back if the save fails. */
export const paperSelected = (model: Model, paper: Paper): UpdateReturn =>
  Option.match(ownBoard(model.board), {
    onNone: () => ({ model }),
    onSome: (own) =>
      own.paper === paper
        ? { model }
        : {
            model: withPaper(model, own.name, paper),
            commands: [UpdatePaper({ boardId: model.boardId, paper, previous: own.paper })],
          },
  })

/** A paper that did not save gives way to the one before it, unless the person has chosen another since. */
export const paperFailed = (model: Model, attempted: Paper, previous: Paper): UpdateReturn =>
  Option.match(ownBoard(model.board), {
    onNone: () => ({ model }),
    onSome: (own) => (own.paper === attempted ? { model: withPaper(model, own.name, previous) } : { model }),
  })

/** A paper saved: who sees the board and its check, as the server has them, unless another paper is on its way. */
export const paperSaved = (model: Model, board: Board): UpdateReturn =>
  Option.exists(ownBoard(model.board), (own) => own.paper === board.paper)
    ? { model: withChecked(model, board) }
    : { model }

/** A paste that brought no picture leaves the board saying what it said before. */
const pasteEnded = (upload: Upload): Upload =>
  Upload.guards.Pasting(upload)
    ? Option.match(upload.problem, {
        onNone: () => Upload.Idle(),
        onSome: (problem) => Upload.Failed({ problem }),
      })
    : upload

/** Pictures pasted, dropped, chosen or read from the clipboard go up one by one. */
export const picturesChosen = (model: Model, files: ReadonlyArray<File>): UpdateReturn => {
  const taken = Array.take(files, picturesAtOnce)
  if (Array.isReadonlyArrayEmpty(taken)) return { model: modifyFields(model, { upload: pasteEnded }) }
  return picturesSent(
    model,
    taken.map((file) => AddImage({ boardId: model.boardId, file })),
  )
}

/** Pictures on their way to the board, one Command each; each lands on the table when it gets there. */
export const picturesSent = (model: Model, commands: NonNullable<UpdateReturn['commands']>): UpdateReturn => {
  const sending = Upload.guards.Sending(model.upload)
    ? model.upload
    : Upload.Sending({ count: 0, problem: Option.none() })
  return {
    model: modifyFields(model, {
      upload: () => Upload.Sending({ count: sending.count + commands.length, problem: sending.problem }),
    }),
    commands,
  }
}

/** The pieces a look keeps: those ticked in select mode, else every piece on the table; top of the stack first. */
export const lookPieces = (model: Model): ReadonlyArray<PieceId> => {
  const onTable = piecesOnTable(model.items)
  return Ticks.match(model.ticks, {
    Off: () => onTable,
    On: ({ itemIds }) => {
      const ticked = new Set(
        Array.filterMap(model.items, (item) =>
          Schema.is(PieceItem)(item) && itemIds.includes(item.id) ? Result.succeed(item.pieceId) : Result.failVoid,
        ),
      )
      return Array.filter(onTable, (pieceId) => ticked.has(pieceId))
    },
  })
}

export const lookRequested = (model: Model): UpdateReturn => {
  const pieceIds = Array.take(Array.dedupe(lookPieces(model)), maximumLookPieces)
  const own = ownBoard(model.board)
  if (Option.isNone(own) || Array.isReadonlyArrayEmpty(pieceIds))
    return { model: modifyFields(model, { look: () => LookSave.NoPieces() }) }
  return {
    model: modifyFields(model, { look: () => LookSave.Saving(), ticks: () => Ticks.Off() }),
    commands: [SaveLook({ boardId: model.boardId, name: own.value.name, pieceIds })],
  }
}

/** A tap in select mode ticks the item, or unticks it. */
export const tickToggled = (model: Model, id: string): UpdateReturn =>
  Ticks.match(model.ticks, {
    Off: () => ({ model }),
    On: ({ itemIds }) => ({
      model: modifyFields(model, {
        ticks: () =>
          Ticks.On({
            itemIds: itemIds.includes(id) ? Array.filter(itemIds, (ticked) => ticked !== id) : [...itemIds, id],
          }),
      }),
    }),
  })
