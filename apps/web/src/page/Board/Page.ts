import type { Board, Paper, PinId } from '@styld/protocol'
import { Option } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import * as Chrome from './Chrome.ts'
import * as Editor from './Editor/Model.ts'
import type { Services } from './Editor/Edits.ts'
import type { Message } from './Message.ts'
import {
  BoardData,
  BoardShown,
  canChangePins,
  fromBoard,
  ownBoard,
  type Model,
  PinWork,
  withChecked,
  withSharing,
} from './Model.ts'
import { ReloadBoard, UnpinThings, UpdatePaper } from './PageCommands.ts'

// The board page's own steps around its table: its paper, taking a pin off, and catching up when the page comes back
// into view.

export type UpdateReturn = Update.Return<Model, Message, Services>

/** The board as the server sent it, with its table started afresh (a fresh history, nothing selected). */
export const restartedFrom = (model: Model, board: Board): Model =>
  modifyFields(fromBoard(model, board), { editor: (editor) => Editor.restarted(editor, board) })

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
    board.version === model.editor.version
      ? modifyFields(withSharing(model, board), { pins: () => board.pins })
      : modifyFields(restartedFrom(model, board), {
          editor: (editor) => modifyFields(editor, { saving: () => Editor.Saving.Saved() }),
        })
  return { model: modifyFields(next, { pinWork: () => PinWork.Idle() }) }
}

/** Coming back into view, the board is read again, but only while nothing is being changed or saved here. */
export const becameVisible = (model: Model): UpdateReturn =>
  Option.isSome(ownBoard(model.board)) && Editor.isQuiet(model.editor)
    ? { model, commands: [ReloadBoard({ boardId: model.boardId })] }
    : { model }

/** A board changed elsewhere replaces what this page shows, with a fresh history; the same version only brings
 * its pins. */
export const reloaded = (model: Model, board: Board): UpdateReturn => {
  if (!Editor.isQuiet(model.editor)) return { model }
  if (board.version === model.editor.version)
    return { model: modifyFields(withSharing(model, board), { pins: () => board.pins }) }
  return { model: restartedFrom(model, board) }
}

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
