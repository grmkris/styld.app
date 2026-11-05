import { Duration, Option, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { Message } from './Message.ts'
import * as Chrome from './Chrome.ts'
import * as Make from './Make.ts'
import * as Editor from './Editor/Model.ts'
import * as EditorSubscription from './Editor/Subscription.ts'
import { type Model, ownBoard, PinWork } from './Model.ts'
import { sheetShown } from '../Sheet.ts'

/** Whether the editor's own listeners run: on the person's own board, while no sheet covers the table and no pin is
 * on its way (a pin change replaces the saved table). */
export const editorListens = (model: Model): boolean =>
  Option.isSome(ownBoard(model.board)) &&
  !Chrome.isSheetShown(model.chrome) &&
  !Editor.isCovered(model.editor) &&
  !sheetShown(model.make.sheet) &&
  !PinWork.guards.Sending(model.pinWork)

/** The editor's listeners, on the board's page. */
export const subscriptions = Subscription.lift(EditorSubscription.subscriptions)<Model, Message>({
  read: (model) => Option.some(model.editor),
  toParentMessage: (message) => Message.GotEditorMessage({ message }),
})

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
