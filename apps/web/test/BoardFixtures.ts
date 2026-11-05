import { BoardSummary } from '@styld/protocol'
import { Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'
import type * as Editor from '../src/page/Board/Editor/Model.ts'
import type * as EditorMessage from '../src/page/Board/Editor/Message.ts'
import { Message } from '../src/page/Board/Message.ts'
import type { Model } from '../src/page/Board/Model.ts'
import { update as boardUpdate } from '../src/page/Board/Update.ts'

/** A board as the person's list returns it, named `name`; the id is a valid opaque id built from the name. */
export const boardSummaryFixture = (name: string, fields: Partial<Record<keyof BoardSummary, unknown>> = {}) =>
  Schema.decodeUnknownSync(BoardSummary)({
    id: `bd_${name.padEnd(22, 'x')}`,
    name,
    paper: 'paper',
    items: [],
    cover: [],
    pinCount: 0,
    visibility: 'private',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...fields,
  })

/** The board's page with a session, as its owner opens it. */
export const update = (current: Model, sent: Message) => boardUpdate(current, sent, { signedIn: true })

/** A Message of the board's editor, as the board receives it. */
export const edit = (editorMessage: EditorMessage.Message) => Message.GotEditorMessage({ message: editorMessage })
/** The board with its editor changed. */
export const withEditor = (current: Model, change: (editor: Editor.Model) => Editor.Model): Model =>
  modifyFields(current, { editor: change })
