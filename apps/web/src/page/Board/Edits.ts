import type { Board, BoardItem } from '@styld/protocol'
import { Array, Option } from 'effect'
import type * as Crypto from 'effect/Crypto'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { StyldClient } from '../../StyldClient.ts'
import { MakeIds, SaveItems, WaitToSave } from './Commands.ts'
import type { Message } from './Message.ts'
import { fromBoard, Gesture, type Model, Saving } from './Model.ts'

export type Services = StyldClient | Crypto.Crypto
export type UpdateReturn = Update.Return<Model, Message, Services>

const historyLimit = 40
/** Ask for more ids when fewer than this many are left. */
const idsLow = 4

const sameItems = (left: ReadonlyArray<BoardItem>, right: ReadonlyArray<BoardItem>) =>
  JSON.stringify(left) === JSON.stringify(right)

export const findItem = (items: ReadonlyArray<BoardItem>, id: string): Option.Option<BoardItem> =>
  Array.findFirst(items, (item) => item.id === id)

export const withItem = (items: ReadonlyArray<BoardItem>, next: BoardItem): ReadonlyArray<BoardItem> =>
  Array.map(items, (item) => (item.id === next.id ? next : item))

/** The next save: wait a moment for more changes, unless a save is already on its way. */
const scheduled = (model: Model): UpdateReturn => {
  if (Saving.guards.InFlight(model.saving))
    return { model: modifyFields(model, { saving: () => Saving.InFlight({ dirty: true }) }) }
  const generation = model.generation + 1
  return {
    model: modifyFields(model, { generation: () => generation, saving: () => Saving.Waiting({ generation }) }),
    commands: [WaitToSave({ generation })],
  }
}

/** One finished change: the table takes `items`, the table before becomes an undo step, and a save follows. */
export const committed = (model: Model, before: ReadonlyArray<BoardItem>, items: ReadonlyArray<BoardItem>) => {
  const settled = modifyFields(model, { items: () => items, gesture: () => Gesture.Idle() })
  if (sameItems(before, items)) return { model: settled }
  return scheduled(
    modifyFields(settled, {
      past: (past) => Array.takeRight(Array.append(past, before), historyLimit),
      future: () => [],
    }),
  )
}

/** The newest wait has passed: send the table. */
export const saveNow = (model: Model, generation: number): UpdateReturn => {
  if (!Saving.guards.Waiting(model.saving) || model.saving.generation !== generation) return { model }
  return {
    model: modifyFields(model, { saving: () => Saving.InFlight({ dirty: false }) }),
    commands: [SaveItems({ boardId: model.boardId, version: model.version, items: model.items })],
  }
}

/** The server took the table. Changes made while it was on its way are saved next. */
export const saved = (model: Model, board: Board): UpdateReturn => {
  const dirty = Saving.guards.InFlight(model.saving) && model.saving.dirty
  const next = modifyFields(model, {
    version: () => board.version,
    pins: () => board.pins,
    saving: () => Saving.Saved(),
  })
  return dirty ? scheduled(next) : { model: next }
}

/** Another tab or device saved first: show its table and start a fresh history. */
export const replaced = (model: Model, board: Board): UpdateReturn => ({
  model: modifyFields(fromBoard(model, board), {
    saving: () => Saving.Replaced(),
    past: () => [],
    future: () => [],
    gesture: () => Gesture.Idle(),
    maybeSelectedId: (selected) => Option.filter(selected, (id) => Option.isSome(findItem(board.items, id))),
  }),
})

const travelled = (
  model: Model,
  items: ReadonlyArray<BoardItem>,
  past: ReadonlyArray<ReadonlyArray<BoardItem>>,
  future: ReadonlyArray<ReadonlyArray<BoardItem>>,
): UpdateReturn =>
  scheduled(
    modifyFields(model, {
      items: () => items,
      past: () => past,
      future: () => future,
      gesture: () => Gesture.Idle(),
      maybeSelectedId: (selected) => Option.filter(selected, (id) => Option.isSome(findItem(items, id))),
    }),
  )

export const undone = (model: Model): UpdateReturn =>
  Option.match(Array.last(model.past), {
    onNone: () => ({ model }),
    onSome: (previous) =>
      travelled(model, previous, Array.dropRight(model.past, 1), Array.prepend(model.future, model.items)),
  })

export const redone = (model: Model): UpdateReturn =>
  Option.match(Array.head(model.future), {
    onNone: () => ({ model }),
    onSome: (next) => travelled(model, next, Array.append(model.past, model.items), Array.drop(model.future, 1)),
  })

/** Take the next fresh id, asking for more when few are left. */
export const takeId = (
  model: Model,
): Option.Option<{ readonly id: string; readonly model: Model; readonly refill: boolean }> =>
  Option.map(Array.head(model.ids), (id) => ({
    id,
    model: modifyFields(model, { ids: (ids) => Array.drop(ids, 1) }),
    refill: model.ids.length - 1 < idsLow,
  }))

export const refillIds = (refill: boolean) => (refill ? [MakeIds()] : [])
