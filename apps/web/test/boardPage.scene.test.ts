import { catalogVersion } from '@styld/i18n'
import { Board } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Session, update } from '../src/App.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { FocusPin, UnpinThings } from '../src/page/Board/PageCommands.ts'
import { view } from '../src/View.ts'
import { pieceFixture } from './WardrobeFixtures.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const boardId = `bd_${'weekend'.padEnd(22, 'x')}`
const knit = pieceFixture('knit', { name: 'Cable knit' })
const board = Schema.decodeUnknownSync(Board)({
  id: boardId,
  name: 'Weekend',
  paper: 'paper',
  version: 1,
  items: [],
  pins: [{ _tag: 'PiecePin', id: `pn_${'knit'.padEnd(22, 'x')}`, piece: knit, addedAt: '2026-10-31T09:00:00.000Z' }],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
})
const page = modifyFields(
  init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: `/boards/${boardId}`,
    origin: 'https://styld.test',
    telemetryConsent: 'denied',
  }).model,
  { session: () => Session.SignedIn({ claims }), board: () => fromBoard(boardInit(boardId), board) },
)

describe("a board's page", () => {
  test('asks before a pin comes off, since it leaves the collage too', () => {
    scene(
      { update, view },
      given(page),
      click(role('button', { name: 'Take Cable knit off the board' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      expect(role('group', { name: 'Take Cable knit off the board' })).toHaveText(
        /Take it off the board\? It comes off the collage too\./,
      ),
      click(role('button', { name: 'Keep' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      expect(role('button', { name: 'Keep' })).not.toExist(),
      click(role('button', { name: 'Take Cable knit off the board' })),
      Command.resolve(FocusPin, BoardMessage.CompletedFocusPin()),
      click(role('button', { name: 'Take off' })),
      Command.expectExact(UnpinThings),
      Command.resolve(UnpinThings, BoardMessage.SucceededPins({ board: { ...board, pins: [], version: 2 } })),
      expect(role('button', { name: 'Take Cable knit off the board' })).not.toExist(),
    )
  })
})
