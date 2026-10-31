import { catalogVersion } from '@styld/i18n'
import { Board, BoardSummary } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, role, scene, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Message as AppMessage, Session, update } from '../src/App.ts'
import { BoardsData, CreateBoard, Message as BoardsMessage } from '../src/page/Boards.ts'
import { Navigate } from '../src/Navigation.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const boardId = (name: string) => `bd_${name.padEnd(22, 'x')}`
const summary = (name: string, changes: object) =>
  Schema.decodeUnknownSync(BoardSummary)({
    id: boardId(name),
    name,
    paper: 'paper',
    items: [],
    cover: [],
    pinCount: 0,
    visibility: 'private',
    updatedAt: '2026-10-31T08:00:00.000Z',
    ...changes,
  })
const created = Schema.decodeUnknownSync(Board)({
  id: boardId('new'),
  name: 'My board',
  paper: 'paper',
  version: 0,
  items: [],
  pins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
})

const boardsPage = (boards: ReadonlyArray<BoardSummary>) =>
  modifyFields(
    init({
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      pathname: '/boards',
      origin: 'https://styld.test',
      telemetryConsent: 'denied',
    }).model,
    {
      session: () => Session.SignedIn({ claims }),
      boards: (current) => modifyFields(current, { boards: () => BoardsData.Success({ data: boards }) }),
    },
  )

describe('the boards list', () => {
  test('starts a new board from the round + at the top, under the default name, and opens it', () => {
    scene(
      { update, view },
      given(boardsPage([summary('Sea', {})])),
      expect(role('textbox')).toBeAbsent(),
      click(role('button', { name: 'New board' })),
      expect(role('button', { name: 'Creating…' })).toBeDisabled(),
      Command.resolve(CreateBoard({ name: 'My board' }), BoardsMessage.SucceededCreateBoard({ board: created })),
      Command.resolve(Navigate({ href: `/boards/${created.id}` }), AppMessage.CompletedNavigate()),
    )
  })

  test('says when a new board was not made, and the + asks again', () => {
    scene(
      { update, view },
      given(boardsPage([])),
      click(role('button', { name: 'New board' })),
      Command.resolve(CreateBoard, BoardsMessage.FailedCreateBoard()),
      expect(role('alert')).toHaveText('The board wasn’t created. Try again.'),
      expect(role('button', { name: 'New board' })).toBeEnabled(),
      expect(text('No boards yet. Make one and lay out an outfit, a trip or a season.')).toExist(),
    )
  })
})
