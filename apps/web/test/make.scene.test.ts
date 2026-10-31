import { Dialog } from '@foldkit/ui'
import { catalogVersion } from '@styld/i18n'
import { Board, Generation } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, Mount, role, scene, submit, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { init, Session, update } from '../src/App.ts'
import { AskForPictures, Message as MakeMessage, PollGeneration } from '../src/page/Board/Make.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { ReloadBoard } from '../src/page/Board/PageCommands.ts'
import { view } from '../src/View.ts'

const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }
const boardId = `bd_${'sea'.padEnd(22, 'x')}`
const imageId = `bm_${'sea'.padEnd(22, 'x')}`
const board = Schema.decodeUnknownSync(Board)({
  id: boardId,
  name: 'Sea',
  paper: 'paper',
  version: 1,
  items: [],
  pins: [
    {
      _tag: 'PicturePin',
      id: `pn_${'sea'.padEnd(22, 'x')}`,
      imageId,
      generated: true,
      addedAt: '2026-10-31T09:00:00.000Z',
    },
  ],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
})
const generation = (status: string, pictures: ReadonlyArray<string>) =>
  Schema.decodeUnknownSync(Generation)({
    id: `gj_${'sea'.padEnd(22, 'x')}`,
    boardId,
    kind: 'moodBoard',
    status,
    reason: null,
    pictures: pictures.map((picture, index) => ({
      index,
      status: picture,
      imageId: picture === 'drawn' ? imageId : null,
    })),
    createdAt: '2026-10-31T09:00:00.000Z',
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

const openSheet = [
  click(role('button', { name: 'Make with Styld' })),
  Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
] as const

describe('Make with Styld on a board', () => {
  test('says by the Make button what the chosen kind costs', () => {
    scene(
      { update, view },
      given(page),
      ...openSheet,
      expect(role('button', { name: 'Make' })).toHaveAccessibleDescription(
        'Up to 4 credits, one per picture, from today’s free allowance. Credits come back for pictures that don’t come out.',
      ),
      click(role('button', { name: /^One picture/ })),
      expect(role('button', { name: 'Make' })).toHaveAccessibleDescription(
        '1 credit from today’s free allowance. It comes back if the picture doesn’t come out.',
      ),
    )
  })

  test('marks a generated picture, and makes a mood board from the person’s words', () => {
    scene(
      { update, view },
      given(page),
      expect(text('Generated')).toExist(),
      click(role('button', { name: 'Make with Styld' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      expect(role('button', { name: /^A mood board/ })).toHaveAttr('aria-pressed', 'true'),
      type(role('textbox', { name: 'What should it feel like?' }), 'a slow weekend by the sea'),
      submit(role('form')),
      Command.resolve(AskForPictures, MakeMessage.SucceededAsk({ generation: generation('planning', []) })),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('status')).toHaveText('Planning your mood board…'),
      Command.resolve(
        PollGeneration,
        MakeMessage.SucceededPoll({ generation: generation('done', ['drawn', 'drawn']) }),
      ),
      Command.resolve(ReloadBoard, BoardMessage.SucceededReloadBoard({ board })),
      expect(text('Added 2 pictures')).toExist(),
    )
  })
})
