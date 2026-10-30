import {
  type BoardImageId,
  type BoardItem,
  BoardItemId,
  ImageItem,
  maximumLookPieces,
  type Paper,
  PieceId,
  PieceItem,
  TextItem,
  type TextStyle,
} from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { AddImage, SaveLook, UpdatePaper, WaitForExit, WaitForToast } from './Commands.ts'
import { committed, findItem, refillIds, takeId, type UpdateReturn, withItem } from './Edits.ts'
import { landing, piecesOnTable, settle, stepped, topZ } from './Geometry.ts'
import { BoardState, LookSave, type Model, Toast, Upload } from './Model.ts'

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
    onNonEmpty: ([first]) => removed(model, first.id),
  })
}

export const addedText = (model: Model, text: string): UpdateReturn =>
  // A label lands across the middle: words run wider than a piece.
  added(model, (id) => TextItem.make({ id, text, style: 'label', ...landing(model.items, 360), x: 500 }))

export const addedImage = (model: Model, imageId: BoardImageId): UpdateReturn => {
  const sending = Upload.guards.Sending(model.upload) ? model.upload.count - 1 : 0
  return added(
    modifyFields(model, { upload: () => (sending > 0 ? Upload.Sending({ count: sending }) : Upload.Idle()) }),
    (id) => ImageItem.make({ id, imageId, ...landing(model.items, 420) }),
  )
}

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

export const layered = (model: Model, id: string, direction: 'forward' | 'backward') =>
  committed(model, model.items, stepped(model.items, id, direction))

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

export const paperSelected = (model: Model, paper: Paper): UpdateReturn => {
  const { board } = model
  if (!BoardState.guards.Ready(board)) return { model }
  return {
    model: modifyFields(model, { board: () => BoardState.Ready({ name: board.name, paper }) }),
    commands: [UpdatePaper({ boardId: model.boardId, paper })],
  }
}

/** Pictures pasted, dropped, chosen or read from the clipboard go up one by one. */
export const picturesChosen = (model: Model, files: ReadonlyArray<File>): UpdateReturn => {
  const taken = Array.take(files, picturesAtOnce)
  if (Array.isReadonlyArrayEmpty(taken)) return { model: modifyFields(model, { isPasting: () => false }) }
  const sending = Upload.guards.Sending(model.upload) ? model.upload.count : 0
  return {
    model: modifyFields(model, {
      upload: () => Upload.Sending({ count: sending + taken.length }),
      isPasting: () => false,
    }),
    commands: taken.map((file) => AddImage({ boardId: model.boardId, file })),
  }
}

export const lookRequested = (model: Model): UpdateReturn => {
  const pieceIds = Array.take(piecesOnTable(model.items), maximumLookPieces)
  const { board } = model
  if (!BoardState.guards.Ready(board) || Array.isReadonlyArrayEmpty(pieceIds))
    return { model: modifyFields(model, { look: () => LookSave.NoPieces() }) }
  return {
    model: modifyFields(model, { look: () => LookSave.Saving() }),
    commands: [SaveLook({ name: board.name, pieceIds })],
  }
}
