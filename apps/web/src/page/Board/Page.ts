import type { Board, PinId } from '@styld/protocol'
import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import * as Chrome from './Chrome.ts'
import type { UpdateReturn } from './Edits.ts'
import { canChangePins, fromBoard, Gesture, ownBoard, type Model, PinWork, Saving, withSharing } from './Model.ts'
import { ReloadBoard, UnpinThings } from './PageCommands.ts'

// The board page's own steps around its table: taking a pin off, and catching up when the page comes back into view.

/** The pin goes, unless the table is still settling; the ⋯ sheet stops asking about it once it is sent. */
export const unpinConfirmed = (model: Model, pinId: PinId): UpdateReturn =>
  canChangePins(model)
    ? {
        model: modifyFields(model, { pinWork: () => PinWork.Sending(), chrome: Chrome.unpinSent }),
        commands: [UnpinThings({ boardId: model.boardId, pinIds: [pinId] })],
      }
    : { model }

/** The board after pinning or unpinning. Unpinning can take things off the table, which moves its version on. */
export const pinsChanged = (model: Model, board: Board): UpdateReturn => {
  const next: Model =
    board.version === model.version
      ? modifyFields(withSharing(model, board), { pins: () => board.pins })
      : modifyFields(fromBoard(model, board), {
          past: () => [],
          future: () => [],
          maybeSelectedId: () => Option.none(),
          saving: () => Saving.Saved(),
        })
  return { model: modifyFields(next, { pinWork: () => PinWork.Idle() }) }
}

/** Coming back into view, the board is read again, but only while nothing is being changed or saved here. */
export const becameVisible = (model: Model): UpdateReturn =>
  Option.isSome(ownBoard(model.board)) && Saving.guards.Saved(model.saving) && Gesture.guards.Idle(model.gesture)
    ? { model, commands: [ReloadBoard({ boardId: model.boardId })] }
    : { model }

/** A board changed elsewhere replaces what this page shows, with a fresh history; the same version only brings
 * its pins. */
export const reloaded = (model: Model, board: Board): UpdateReturn => {
  if (!Saving.guards.Saved(model.saving) || !Gesture.guards.Idle(model.gesture)) return { model }
  if (board.version === model.version)
    return {
      model: modifyFields(withSharing(model, board), { pins: () => board.pins }),
    }
  return {
    model: modifyFields(fromBoard(model, board), {
      past: () => [],
      future: () => [],
      maybeSelectedId: () => Option.none(),
    }),
  }
}
