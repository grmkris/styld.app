import { type Board, maximumMoods, type Mood } from '@styld/protocol'
import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from '../Sheet.ts'
import type { UpdateReturn } from './Edits.ts'
import { Message } from './Message.ts'
import {
  BoardData,
  canChangePins,
  boardName,
  BoardShown,
  fromBoard,
  Gesture,
  ownBoard,
  type Model,
  PinWork,
  Publishing,
  Removal,
  Rename,
  Saving,
  withChecked,
  withSharing,
} from './Model.ts'
import {
  DeleteBoard,
  LeaveBoard,
  ReloadBoard,
  RenameBoard,
  SetBoardMoods,
  SetBoardVisibility,
  FocusName,
  FocusPin,
  keepPinId,
  UnpinThings,
  unpinId,
} from './PageCommands.ts'

// The board page's own steps: its name, its ⋯ sheet, its pins, and catching up when the page comes back into view.

const moreSheet = sheetFolds<Model, Message>({
  read: (model) => model.more,
  write: (model, nextMore) => modifyFields(model, { more: () => nextMore }),
  toParentMessage: (message) => Message.GotMoreMessage({ message }),
})

/** Closing the ⋯ sheet, for a row whose action follows. */
export const closeMore = moreSheet.close

/** The ⋯ sheet opens with nothing pending. */
const moreOpened = (model: Model): UpdateReturn =>
  moreSheet.open(modifyFields(model, { removal: () => Removal.Idle() }))

/** The title becomes a field holding the board's name, focused. */
export const renameStarted = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { nameDraft: () => boardName(model.board), rename: () => Rename.Editing() }),
  commands: [FocusName()],
})

const renameSubmitted = (model: Model): UpdateReturn => {
  const name = model.nameDraft.trim()
  if (name.length === 0 || name === boardName(model.board))
    return { model: modifyFields(model, { rename: () => Rename.Idle() }) }
  return {
    model: modifyFields(model, { rename: () => Rename.Saving() }),
    commands: [RenameBoard({ boardId: model.boardId, name })],
  }
}

const renamed = (model: Model, board: Board): UpdateReturn => ({
  model: modifyFields(model, {
    board: () => BoardData.Success({ data: BoardShown.Own({ name: board.name, paper: board.paper }) }),
    rename: () => Rename.Idle(),
  }),
})

/** A mood on or off, saved at once; a fourth waits until one is taken off. */
const moodToggled = (model: Model, mood: Mood): UpdateReturn => {
  const moods = model.moods.includes(mood)
    ? model.moods.filter((each) => each !== mood)
    : model.moods.length < maximumMoods
      ? [...model.moods, mood]
      : model.moods
  return moods === model.moods
    ? { model }
    : {
        model: modifyFields(model, { moods: () => moods }),
        commands: [SetBoardMoods({ boardId: model.boardId, moods, previous: model.moods })],
      }
}

const sameMoods = (left: ReadonlyArray<Mood>, right: ReadonlyArray<Mood>) =>
  left.length === right.length && left.every((mood) => right.includes(mood))

/** Moods that did not save give way to the ones before them, unless the person has changed them again since. */
const moodsFailed = (model: Model, attempted: ReadonlyArray<Mood>, previous: ReadonlyArray<Mood>): UpdateReturn =>
  sameMoods(model.moods, attempted) ? { model: modifyFields(model, { moods: () => previous }) } : { model }

/** Moods saved: who sees the board and its check as the server has them, unless other moods are on their way. */
const moodsSaved = (model: Model, board: Board): UpdateReturn =>
  sameMoods(model.moods, board.moods) ? { model: withChecked(model, board) } : { model }

/** Public or private, from the switch beside Share; the check's word on it shows under the title. */
const publicToggled = (model: Model, isPublic: boolean): UpdateReturn =>
  Publishing.guards.Sending(model.publishing)
    ? { model }
    : {
        model: modifyFields(model, { publishing: () => Publishing.Sending() }),
        commands: [SetBoardVisibility({ boardId: model.boardId, isPublic })],
      }

const deletionConfirmed = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { removal: () => Removal.Deleting() }),
  commands: [DeleteBoard({ boardId: model.boardId })],
})

const deleted = (model: Model): UpdateReturn => ({ model, commands: [LeaveBoard()] })

/** The × asks first: the pin leaves the board and its table, and a picture is deleted, with no way to put it back. */
const unpinAsked = (model: Model, pinId: string): UpdateReturn => ({
  model: modifyFields(model, { unpinning: () => Option.some(pinId) }),
  commands: [FocusPin({ selector: `#${keepPinId(pinId)}` })],
})

const unpinned = (model: Model, pinId: string): UpdateReturn =>
  canChangePins(model)
    ? {
        model: modifyFields(model, { pinWork: () => PinWork.Sending(), unpinning: () => Option.none() }),
        commands: [UnpinThings({ boardId: model.boardId, pinIds: [pinId] })],
      }
    : { model }

const pinKept = (model: Model, pinId: string): UpdateReturn => ({
  model: modifyFields(model, { unpinning: () => Option.none() }),
  commands: [FocusPin({ selector: `#${unpinId(pinId)}` })],
})

/** The board after pinning or unpinning. Unpinning can take things off the table, which moves its version on. */
const pinsChanged = (model: Model, board: Board): UpdateReturn => {
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
const becameVisible = (model: Model): UpdateReturn =>
  Option.isSome(ownBoard(model.board)) && Saving.guards.Saved(model.saving) && Gesture.guards.Idle(model.gesture)
    ? { model, commands: [ReloadBoard({ boardId: model.boardId })] }
    : { model }

/** A board changed elsewhere replaces what this page shows, with a fresh history; the same version only brings
 * its pins. */
const reloaded = (model: Model, board: Board): UpdateReturn => {
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

type PageTag =
  | 'BecameVisible'
  | 'CompletedReloadBoard'
  | 'ClickedMore'
  | 'GotMoreMessage'
  | 'ClickedRename'
  | 'ClickedCancelRename'
  | 'CompletedFocusName'
  | 'UpdatedNameDraft'
  | 'SubmittedRename'
  | 'SucceededRename'
  | 'FailedRename'
  | 'ToggledPublic'
  | 'ToggledMood'
  | 'SucceededSetBoardMoods'
  | 'FailedSetBoardMoods'
  | 'SucceededSetVisibility'
  | 'FailedSetVisibility'
  | 'ClickedDeleteBoard'
  | 'ClickedKeepBoard'
  | 'ClickedConfirmDelete'
  | 'SucceededDeleteBoard'
  | 'FailedDeleteBoard'
  | 'CompletedLeaveBoard'
  | 'ClickedUnpin'
  | 'ClickedConfirmUnpin'
  | 'ClickedKeepPin'
  | 'CompletedFocusPin'
  | 'SucceededPins'
  | 'FailedPins'

/** How the board page's own Messages change the board, for the board's update to spread into its match. */
export const pageSteps = (
  model: Model,
): { readonly [Tag in PageTag]: (message: Extract<Message, { readonly _tag: Tag }>) => UpdateReturn } => ({
  BecameVisible: () => becameVisible(model),
  CompletedReloadBoard: ({ maybeBoard }) =>
    Option.match(maybeBoard, { onNone: () => ({ model }), onSome: (board) => reloaded(model, board) }),
  ClickedMore: () => moreOpened(model),
  GotMoreMessage: (got) => moreSheet.update(model, got.message),
  ClickedRename: () => renameStarted(model),
  ClickedCancelRename: () => ({ model: modifyFields(model, { rename: () => Rename.Idle() }) }),
  CompletedFocusName: () => ({ model }),
  UpdatedNameDraft: ({ value }) => ({ model: modifyFields(model, { nameDraft: () => value }) }),
  SubmittedRename: () => renameSubmitted(model),
  SucceededRename: ({ board }) => renamed(model, board),
  FailedRename: () => ({ model: modifyFields(model, { rename: () => Rename.Failed() }) }),
  ToggledPublic: ({ isPublic }) => publicToggled(model, isPublic),
  ToggledMood: ({ mood }) => moodToggled(model, mood),
  SucceededSetBoardMoods: ({ board }) => moodsSaved(model, board),
  FailedSetBoardMoods: ({ attempted, previous }) => moodsFailed(model, attempted, previous),
  SucceededSetVisibility: ({ board }) => {
    return { model: modifyFields(withSharing(model, board), { publishing: () => Publishing.Idle() }) }
  },
  FailedSetVisibility: ({ needsProfile }) => ({
    model: modifyFields(model, { publishing: () => Publishing.Failed({ needsProfile }) }),
  }),
  ClickedDeleteBoard: () => ({ model: modifyFields(model, { removal: () => Removal.Confirming() }) }),
  ClickedKeepBoard: () => ({ model: modifyFields(model, { removal: () => Removal.Idle() }) }),
  ClickedConfirmDelete: () => deletionConfirmed(model),
  SucceededDeleteBoard: () => deleted(model),
  FailedDeleteBoard: () => ({ model: modifyFields(model, { removal: () => Removal.Failed() }) }),
  CompletedLeaveBoard: () => ({ model }),
  ClickedUnpin: ({ pinId }) => unpinAsked(model, pinId),
  ClickedConfirmUnpin: ({ pinId }) => unpinned(model, pinId),
  ClickedKeepPin: ({ pinId }) => pinKept(model, pinId),
  CompletedFocusPin: () => ({ model }),
  SucceededPins: ({ board }) => pinsChanged(model, board),
  FailedPins: () => ({ model: modifyFields(model, { pinWork: () => PinWork.Failed() }) }),
})
