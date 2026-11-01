import { type Board, type Look, maximumMoods, type Mood } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from '../Sheet.ts'
import type { UpdateReturn } from './Edits.ts'
import { Message } from './Message.ts'
import {
  BoardData,
  boardName,
  BoardShown,
  fromBoard,
  Gesture,
  LooksData,
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
  LoadLooks,
  PinThings,
  ReloadBoard,
  RenameBoard,
  SetBoardMoods,
  SetBoardVisibility,
  FocusPin,
  keepPinId,
  readShown,
  UnpinThings,
  unpinId,
} from './PageCommands.ts'

// The board page's own steps: its settings sheet, its pins and the picker that adds them, and catching up when
// the page comes back into view.

const settingsSheet = sheetFolds<Model, Message>({
  read: (model) => model.settings,
  write: (model, nextSettings) => modifyFields(model, { settings: () => nextSettings }),
  toParentMessage: (message) => Message.GotSettingsMessage({ message }),
})
const pickerSheet = sheetFolds<Model, Message>({
  read: (model) => model.picker,
  write: (model, nextPicker) => modifyFields(model, { picker: () => nextPicker }),
  toParentMessage: (message) => Message.GotPickerMessage({ message }),
})

const foldSettings = settingsSheet.update
const foldPicker = pickerSheet.update
const openSettings = settingsSheet.open
const closeSettings = settingsSheet.close
const openPicker = pickerSheet.open
const closePicker = pickerSheet.close

/** The settings sheet opens on the board's name, with nothing pending. */
const settingsOpened = (model: Model): UpdateReturn =>
  openSettings(
    modifyFields(model, {
      nameDraft: () => boardName(model.board),
      rename: () => Rename.Idle(),
      removal: () => Removal.Idle(),
    }),
  )

const renameSubmitted = (model: Model): UpdateReturn => {
  const name = model.nameDraft.trim()
  if (name.length === 0 || name === boardName(model.board)) return closeSettings(model)
  return {
    model: modifyFields(model, { rename: () => Rename.Saving() }),
    commands: [RenameBoard({ boardId: model.boardId, name })],
  }
}

const renamed = (model: Model, board: Board): UpdateReturn =>
  closeSettings(
    modifyFields(model, {
      board: () => BoardData.Success({ data: BoardShown.Own({ name: board.name, paper: board.paper }) }),
      rename: () => Rename.Idle(),
    }),
  )

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

/** Public or private, from the settings; the sheet stays open to show what Styld's check says. */
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

const unpinned = (model: Model, pinId: string): UpdateReturn => ({
  model: modifyFields(model, { pinWork: () => PinWork.Sending(), unpinning: () => Option.none() }),
  commands: [UnpinThings({ boardId: model.boardId, pinIds: [pinId] })],
})

const pinKept = (model: Model, pinId: string): UpdateReturn => ({
  model: modifyFields(model, { unpinning: () => Option.none() }),
  commands: [FocusPin({ selector: `#${unpinId(pinId)}` })],
})

/** The picker opens with nothing ticked, and asks for the person's looks the first time. */
const pickerOpened = (model: Model): UpdateReturn => {
  const next = modifyFields(model, { picks: () => [], pinWork: () => PinWork.Idle() })
  const opened = openPicker(next)
  return AsyncData.isIdle(model.looks)
    ? {
        ...opened,
        model: modifyFields(opened.model, { looks: () => AsyncData.Loading() }),
        commands: [...(opened.commands ?? []), LoadLooks()],
      }
    : opened
}

const pickToggled = (model: Model, pick: string): UpdateReturn => ({
  model: modifyFields(model, {
    picks: (picks) => (picks.includes(pick) ? Array.filter(picks, (each) => each !== pick) : [...picks, pick]),
  }),
})

const picked = (picks: ReadonlyArray<string>, kind: 'piece' | 'look') =>
  Array.flatMap(picks, (pick) => (pick.startsWith(`${kind}:`) ? [pick.slice(kind.length + 1)] : []))

const picksSubmitted = (model: Model): UpdateReturn =>
  model.picks.length === 0
    ? closePicker(model)
    : {
        model: modifyFields(model, { pinWork: () => PinWork.Sending() }),
        commands: [
          PinThings({
            boardId: model.boardId,
            pieceIds: picked(model.picks, 'piece'),
            lookIds: picked(model.picks, 'look'),
          }),
        ],
      }

/** The board after pinning or unpinning. Unpinning can take things off the table, which moves its version on. */
const pinsChanged = (model: Model, board: Board): UpdateReturn =>
  closePicker(
    modifyFields(
      board.version === model.version
        ? modifyFields(withSharing(model, board), { pins: () => board.pins })
        : fromBoard(model, board),
      {
        pinWork: () => PinWork.Idle(),
        picks: () => [],
      },
    ),
  )

const looksLoaded = (model: Model, looks: ReadonlyArray<Look>): UpdateReturn => ({
  model: modifyFields(model, { looks: () => LooksData.Success({ data: looks }) }),
})

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
  | 'ClickedSettings'
  | 'GotSettingsMessage'
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
  | 'ClickedAddPins'
  | 'GotPickerMessage'
  | 'ToggledPick'
  | 'SubmittedPicks'
  | 'SucceededLoadLooks'
  | 'FailedLoadLooks'
  | 'SucceededPins'
  | 'FailedPins'
  | 'SucceededReadShown'
  | 'FailedReadShown'

/** How the board page's own Messages change the board, for the board's update to spread into its match. */
export const pageSteps = (
  model: Model,
): { readonly [Tag in PageTag]: (message: Extract<Message, { readonly _tag: Tag }>) => UpdateReturn } => ({
  BecameVisible: () => becameVisible(model),
  CompletedReloadBoard: ({ maybeBoard }) =>
    Option.match(maybeBoard, { onNone: () => ({ model }), onSome: (board) => reloaded(model, board) }),
  ClickedSettings: () => settingsOpened(model),
  GotSettingsMessage: (got) => foldSettings(model, got.message),
  UpdatedNameDraft: ({ value }) => ({ model: modifyFields(model, { nameDraft: () => value }) }),
  SubmittedRename: () => renameSubmitted(model),
  SucceededRename: ({ board }) => renamed(model, board),
  FailedRename: () => ({ model: modifyFields(model, { rename: () => Rename.Failed() }) }),
  ToggledPublic: ({ isPublic }) => publicToggled(model, isPublic),
  ToggledMood: ({ mood }) => moodToggled(model, mood),
  SucceededSetBoardMoods: ({ board }) => moodsSaved(model, board),
  FailedSetBoardMoods: ({ attempted, previous }) => moodsFailed(model, attempted, previous),
  SucceededSetVisibility: ({ board }) => {
    const next = modifyFields(withSharing(model, board), { publishing: () => Publishing.Idle() })
    return { model: next, commands: readShown(next) }
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
  ClickedAddPins: () => pickerOpened(model),
  GotPickerMessage: (got) => foldPicker(model, got.message),
  ToggledPick: ({ pick }) => pickToggled(model, pick),
  SubmittedPicks: () => picksSubmitted(model),
  SucceededLoadLooks: ({ looks }) => looksLoaded(model, looks),
  FailedLoadLooks: () => ({
    model: modifyFields(model, { looks: () => LooksData.Failure({ error: 'Unavailable' }) }),
  }),
  SucceededPins: ({ board }) => {
    const changed = pinsChanged(model, board)
    return { ...changed, commands: [...(changed.commands ?? []), ...readShown(changed.model)] }
  },
  SucceededReadShown: ({ pinIds }) => ({ model: modifyFields(model, { shownToOthers: () => Option.some(pinIds) }) }),
  FailedReadShown: () => ({ model: modifyFields(model, { shownToOthers: () => Option.none() }) }),
  FailedPins: () => ({ model: modifyFields(model, { pinWork: () => PinWork.Failed() }) }),
})
