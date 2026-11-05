import { Board, Paper, PublicBoard } from '@styld/protocol'
import * as Chrome from './Chrome.ts'
import * as EditorMessage from './Editor/Message.ts'
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'
import * as People from '../People.ts'
import * as TryIt from './TryIt.ts'
import * as Share from '../Share.ts'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { LoadError } from '../../ServerData.ts'

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadBoard: { board: Board },
  FailedLoadBoard: { error: LoadError },
  SucceededVisitBoard: { board: PublicBoard },
  ClickedRetry: {},

  SucceededUpdatePaper: { board: Board },
  FailedUpdatePaper: { attempted: Paper, previous: Paper },

  /** The page came back into view: another device or an assistant may have changed the board. */
  BecameVisible: {},
  CompletedReloadBoard: { maybeBoard: Schema.Option(Board) },

  GotEditorMessage: { message: EditorMessage.Message },
  GotChromeMessage: { message: Chrome.Message },
  GotPeopleMessage: { message: People.Message },
  GotTryItMessage: { message: TryIt.Message },
  GotShareMessage: { message: Share.Message },
  GotMakeMessage: { message: Make.Message },
  GotOutfitsMessage: { message: Outfits.Message },

  /** A look put on the table is pinned too; the table is the editor's, so only the pins come back. */
  CompletedPinLook: { maybeBoard: Schema.Option(Board) },
  SucceededPins: { board: Board },
  FailedPins: {},
})
export type Message = typeof Message.Type
