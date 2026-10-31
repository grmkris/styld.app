import { Dialog, RadioGroup } from '@foldkit/ui'
import { Board, Generation } from '@styld/protocol'
import { Schema } from 'effect'
import { click, Command, expect, given, keydown, Mount, role, scene, submit, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'
import { update } from '../src/App.ts'
import { AskToMake, Message as MakeMessage, PollGeneration } from '../src/page/Board/Make.ts'
import { Message as BoardMessage } from '../src/page/Board/Message.ts'
import { fromBoard, init as boardInit } from '../src/page/Board/Model.ts'
import { ReloadBoard } from '../src/page/Board/PageCommands.ts'
import { view } from '../src/View.ts'
import { signedInAt } from './AppFixtures.ts'
import { sceneSheetMoved, sceneSheetOpened } from './SheetFixtures.ts'

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

const page = modifyFields(signedInAt(`/boards/${boardId}`), {
  board: () => fromBoard(boardInit(boardId), board),
})

const resolveFocus = Command.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption())

const openSheet = [
  click(role('button', { name: 'Make with Styld' })),
  Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  ...sceneSheetOpened,
] as const

describe('Make with Styld on a board', () => {
  test('says by the Make button what the chosen kind costs', () => {
    scene(
      { update, view },
      given(page),
      ...openSheet,
      expect(role('button', { name: 'Make' })).toHaveAccessibleDescription(
        '1 credit from today’s free allowance. It comes back if your wardrobe holds too little for it yet.',
      ),
      click(role('radio', { name: 'A sticker' })),
      resolveFocus,
      expect(role('button', { name: 'Make' })).toHaveAccessibleDescription(
        '1 credit from today’s free allowance. It comes back if the sticker doesn’t come out.',
      ),
    )
  })

  test('offers a mood board or a sticker as one radio group, chosen by arrow keys', () => {
    scene(
      { update, view },
      given(page),
      ...openSheet,
      expect(role('radiogroup', { name: 'What to make' })).toExist(),
      expect(role('radio', { name: 'A mood board', checked: true })).toHaveAttr('tabIndex', '0'),
      expect(role('radio', { name: 'A sticker', checked: false })).toHaveAttr('tabIndex', '-1'),
      expect(role('radio', { name: 'A sticker' })).toHaveAccessibleDescription(
        'A small decorative drawing from your words, cut out for the collage.',
      ),
      keydown(role('radio', { name: 'A mood board' }), 'ArrowRight'),
      resolveFocus,
      expect(role('radio', { name: 'A sticker', checked: true })).toHaveAttr('tabIndex', '0'),
      expect(role('radio', { name: 'A mood board', checked: false })).toHaveAttr('tabIndex', '-1'),
    )
  })

  test('reads the Make button as disabled until there are words enough to make from', () => {
    const words = role('textbox', { name: 'What should it feel like?' })
    scene(
      { update, view },
      given(page),
      ...openSheet,
      expect(role('button', { name: 'Make' })).toBeDisabled(),
      type(words, '  ab '),
      expect(role('button', { name: 'Make' })).toBeDisabled(),
      type(words, 'sea'),
      expect(role('button', { name: 'Make' })).toBeEnabled(),
    )
  })

  test('marks a generated sticker, and makes a mood board of the person’s pieces from their words', () => {
    scene(
      { update, view },
      given(page),
      expect(text('Generated')).toExist(),
      click(role('button', { name: 'Make with Styld' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...sceneSheetOpened,
      expect(role('radio', { name: 'A mood board', checked: true })).toExist(),
      type(role('textbox', { name: 'What should it feel like?' }), 'a slow weekend by the sea'),
      submit(role('form')),
      Command.resolve(AskToMake, MakeMessage.SucceededAsk({ generation: generation('planning', []) })),
      ...sceneSheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('status')).toHaveText('Picking your pieces…'),
      Command.resolve(PollGeneration, MakeMessage.SucceededPoll({ generation: generation('done', []) })),
      Command.resolve(ReloadBoard, BoardMessage.SucceededReloadBoard({ board })),
      expect(text('Your mood board is laid out.')).toExist(),
    )
  })
})
