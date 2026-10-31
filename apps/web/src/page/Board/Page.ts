import { Dialog } from '@foldkit/ui'
import { type Board, type Look, maximumMoods, type Mood } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { Services, UpdateReturn } from './Edits.ts'
import { Message } from './Message.ts'
import {
  BoardState,
  fromBoard,
  Gesture,
  LooksData,
  type Model,
  PinWork,
  Publishing,
  Removal,
  Rename,
  Saving,
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

const sheetFold = (
  read: (model: Model) => Dialog.Model,
  write: (model: Model, dialog: Dialog.Model) => Model,
  toParentMessage: (message: Dialog.Message) => Message,
) => ({
  read: (model: Model) => Option.some(read(model)),
  write,
  toParentMessage,
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message, Services>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
})
const settingsSheet = sheetFold(
  (model) => model.settings,
  (model, settings) => modifyFields(model, { settings: () => settings }),
  (message) => Message.GotSettingsMessage({ message }),
)
const pickerSheet = sheetFold(
  (model) => model.picker,
  (model, picker) => modifyFields(model, { picker: () => picker }),
  (message) => Message.GotPickerMessage({ message }),
)

const foldSettings = Update.foldChild({ update: Dialog.update, ...settingsSheet })
const foldPicker = Update.foldChild({ update: Dialog.update, ...pickerSheet })
const openSettings = Update.foldChildStep({ update: Dialog.open, ...settingsSheet })
const closeSettings = Update.foldChildStep({ update: Dialog.close, ...settingsSheet })
const openPicker = Update.foldChildStep({ update: Dialog.open, ...pickerSheet })
const closePicker = Update.foldChildStep({ update: Dialog.close, ...pickerSheet })

const boardName = (model: Model) =>
  BoardState.match(model.board, {
    Loading: () => '',
    Failed: () => '',
    Missing: () => '',
    Ready: ({ name }) => name,
    Visiting: ({ board }) => board.name,
  })

/** The settings sheet opens on the board's name, with nothing pending. */
const settingsOpened = (model: Model): UpdateReturn =>
  openSettings(
    modifyFields(model, {
      nameDraft: () => boardName(model),
      rename: () => Rename.Idle(),
      removal: () => Removal.Idle(),
    }),
  )

const renameSubmitted = (model: Model): UpdateReturn => {
  const name = model.nameDraft.trim()
  if (name.length === 0 || name === boardName(model)) return closeSettings(model)
  return {
    model: modifyFields(model, { rename: () => Rename.Saving() }),
    commands: [RenameBoard({ boardId: model.boardId, name })],
  }
}

const renamed = (model: Model, board: Board): UpdateReturn =>
  closeSettings(
    modifyFields(model, {
      board: () => BoardState.Ready({ name: board.name, paper: board.paper }),
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
        commands: [SetBoardMoods({ boardId: model.boardId, moods })],
      }
}

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
  BoardState.guards.Ready(model.board) && Saving.guards.Saved(model.saving) && Gesture.guards.Idle(model.gesture)
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
  | 'SucceededReloadBoard'
  | 'FailedReloadBoard'
  | 'ClickedSettings'
  | 'GotSettingsMessage'
  | 'UpdatedNameDraft'
  | 'SubmittedRename'
  | 'SucceededRename'
  | 'FailedRename'
  | 'ToggledPublic'
  | 'ToggledMood'
  | 'SucceededSetMoods'
  | 'FailedSetMoods'
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
  SucceededReloadBoard: ({ board }) => reloaded(model, board),
  FailedReloadBoard: () => ({ model }),
  ClickedSettings: () => settingsOpened(model),
  GotSettingsMessage: (got) => foldSettings(model, got.message),
  UpdatedNameDraft: ({ value }) => ({ model: modifyFields(model, { nameDraft: () => value }) }),
  SubmittedRename: () => renameSubmitted(model),
  SucceededRename: ({ board }) => renamed(model, board),
  FailedRename: () => ({ model: modifyFields(model, { rename: () => Rename.Failed() }) }),
  ToggledPublic: ({ isPublic }) => publicToggled(model, isPublic),
  ToggledMood: ({ mood }) => moodToggled(model, mood),
  SucceededSetMoods: ({ board }) => ({ model: withSharing(model, board) }),
  FailedSetMoods: () => ({ model }),
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
  SucceededReadShown: ({ count }) => ({ model: modifyFields(model, { shownToOthers: () => Option.some(count) }) }),
  FailedReadShown: () => ({ model }),
  FailedPins: () => ({ model: modifyFields(model, { pinWork: () => PinWork.Failed() }) }),
})
