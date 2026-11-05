import { Duration, Effect, Option, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import * as Dom from 'foldkit/dom'
import type { Pointer } from './Geometry.ts'
import { Message } from './Message.ts'
import * as AddSheet from './AddSheet.ts'
import * as Chrome from './Chrome.ts'
import * as Make from './Make.ts'
import { Gesture, type Model, ownBoard, PinWork } from './Model.ts'
import { sheetShown } from '../Sheet.ts'

const pointerOf = (event: PointerEvent): Pointer => ({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })

/** Typing in a field keeps the browser's own keys: its undo, its paste. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement

const imageFiles = (data: DataTransfer | null): ReadonlyArray<File> =>
  data === null ? [] : Array.from(data.files).filter((file) => file.type.startsWith('image/'))

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

const shortcut = (event: KeyboardEvent): Option.Option<Message> => {
  if (isTyping(event.target)) return Option.none()
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')
    return Option.some(event.shiftKey ? Message.PressedRedoKey() : Message.PressedUndoKey())
  return event.key === 'Escape' ? Option.some(Message.PressedEscape()) : Option.none()
}

/** Pointer moves and releases anywhere on the page, while a hand is on the table. */
const pointerStream = (isActive: boolean) =>
  Stream.when(
    Stream.mergeAll<Message, never, never>(
      [
        Stream.fromEventListener<PointerEvent>(document, 'pointermove').pipe(
          Stream.map((event) => Message.MovedPointer({ pointer: pointerOf(event) })),
        ),
        Stream.fromEventListener<PointerEvent>(document, 'pointerup').pipe(
          Stream.map((event) => Message.ReleasedPointer({ pointerId: event.pointerId })),
        ),
        Stream.fromEventListener<PointerEvent>(document, 'pointercancel').pipe(
          Stream.map((event) => Message.ReleasedPointer({ pointerId: event.pointerId })),
        ),
      ],
      { concurrency: 'unbounded' },
    ),
    Effect.sync(() => isActive),
  )

/** Files dragged over the page and dropped anywhere on it. */
const dropStream = () =>
  Stream.merge(
    Dom.streamFromEventFilterMapPreventDefault({
      target: document,
      type: 'dragover',
      filterMapEvent: (event) => (carriesFiles(event) ? Option.some(Message.DraggedFilesOver()) : Option.none()),
    }),
    Stream.merge(
      Dom.streamFromEventFilterMapPreventDefault({
        target: document,
        type: 'drop',
        filterMapEvent: (event) =>
          carriesFiles(event)
            ? Option.some(Message.DroppedFiles({ files: imageFiles(event.dataTransfer) }))
            : Option.none(),
      }),
      Dom.streamFromEventFilterMap({
        target: document,
        type: 'dragleave',
        filterMapEvent: (event) =>
          event.relatedTarget === null ? Option.some(Message.EndedFileDrag()) : Option.none(),
      }),
    ),
  )

/** Pictures pasted anywhere on the page, unless the person is typing. */
const pasteStream = () =>
  Dom.streamFromEventFilterMapPreventDefault({
    target: document,
    type: 'paste',
    filterMapEvent: (event) => {
      const files = imageFiles(event.clipboardData)
      return files.length === 0 || isTyping(event.target) ? Option.none() : Option.some(Message.PastedFiles({ files }))
    },
  })

/** Whether the editor's own listeners run: on the person's own board, while no sheet covers the table and no pin is
 * on its way (a pin change replaces the saved table). */
export const editorListens = (model: Model): boolean =>
  Option.isSome(ownBoard(model.board)) &&
  !Chrome.isSheetShown(model.chrome) &&
  !AddSheet.isSheetShown(model.addSheet) &&
  !sheetShown(model.make.sheet) &&
  !PinWork.guards.Sending(model.pinWork)

/** While a hand is on the table the whole page reports the pointer, so a finger that leaves an item (or a
 * second finger anywhere) still moves it. Keys, pasted pictures and dropped files work from anywhere on the
 * board's page. */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  documentPointer: entry(
    { isActive: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isActive: !Gesture.guards.Idle(model.gesture) }),
      dependenciesToStream: ({ isActive }) => pointerStream(isActive),
    },
  ),
  documentKeys: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Dom.streamFromEventFilterMapPreventDefault({ target: document, type: 'keydown', filterMapEvent: shortcut }),
    },
  ),
  documentPaste: entry({}, { modelToDependencies: () => ({}), dependenciesToStream: pasteStream }),
  documentDrop: entry({}, { modelToDependencies: () => ({}), dependenciesToStream: dropStream }),
}))

/** The page coming back into view, or its window back into focus: an assistant or another device may have changed
 * the board meanwhile. The two arrive together on a phone, so a burst counts once. */
const visibleAgain = () =>
  Stream.merge(
    Stream.fromEventListener(document, 'visibilitychange').pipe(
      Stream.filter(() => document.visibilityState === 'visible'),
    ),
    Stream.fromEventListener(window, 'focus'),
  ).pipe(
    Stream.debounce(Duration.millis(300)),
    Stream.map(() => Message.BecameVisible()),
  )

/** What a board's page listens for, the grid's and the collage's alike: coming back into view, and a Make with Styld
 * job while it runs. */
export const pageSubscriptions = {
  ...Subscription.make<Model, Message>()((entry) => ({
    boardVisible: entry({}, { modelToDependencies: () => ({}), dependenciesToStream: visibleAgain }),
  })),
  ...Subscription.lift(Make.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.make),
    toParentMessage: (message) => Message.GotMakeMessage({ message }),
  }),
}
