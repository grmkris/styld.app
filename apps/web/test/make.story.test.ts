import { Dialog, RadioGroup } from '@foldkit/ui'
import { Generation } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'
import { AskForPictures, init, Job, kinds, Message, PollGeneration, update } from '../src/page/Board/Make.ts'

const boardId = `bd_${'sea'.padEnd(22, 'x')}`
const generationId = `gj_${'sea'.padEnd(22, 'x')}`
const generation = (status: string, pictures: ReadonlyArray<string>) =>
  Schema.decodeUnknownSync(Generation)({
    id: generationId,
    boardId,
    kind: 'moodBoard',
    status,
    reason: null,
    pictures: pictures.map((picture, index) => ({
      index,
      status: picture,
      imageId: picture === 'drawn' ? `bm_${String(index).padEnd(22, 'x')}` : null,
    })),
    createdAt: '2026-10-31T09:00:00.000Z',
  })

const choseOnePicture = [
  message(
    Message.GotKindChoiceMessage({
      message: RadioGroup.Message.SelectedOption({ index: kinds.indexOf('picture'), value: 'picture' }),
    }),
  ),
  Command.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption()),
] as const

describe('making pictures for a board', () => {
  test('sends the words as a mood board, follows the job while it runs, and says once it is done', () => {
    story(
      update,
      given(init(boardId)),
      message(Message.ClickedMake()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      message(Message.ChangedWords({ words: '  a slow weekend by the sea ' })),
      message(Message.SubmittedMake()),
      Command.expectExact(
        AskForPictures({ boardId, kind: 'moodBoard', prompt: 'a slow weekend by the sea', operationId: Option.none() }),
      ),
      Command.resolve(AskForPictures, Message.SucceededAsk({ generation: generation('planning', []) })),
      model(({ job, words, sheet }) => {
        expect(Job.guards.Running(job)).toBe(true)
        expect(words).toBe('')
        expect(sheet.isOpen).toBe(false)
      }),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Command.resolve(
        PollGeneration({ generationId }),
        Message.SucceededPoll({ generation: generation('drawing', ['drawn', 'waiting']) }),
      ),
      Command.resolve(
        PollGeneration({ generationId }),
        Message.SucceededPoll({ generation: generation('done', ['drawn', 'drawn']) }),
      ),
      model(({ job }) => expect(Job.guards.Finished(job)).toBe(true)),
      expectOutMessage({ _tag: 'FinishedMaking' }),
    )
  })

  test('one picture, tried again under the same operation after a failure that may not have arrived', () => {
    story(
      update,
      given(init(boardId)),
      ...choseOnePicture,
      message(Message.ChangedWords({ words: 'a red coat in the snow' })),
      message(Message.SubmittedMake()),
      Command.resolve(AskForPictures, Message.FailedAsk({ problem: 'failed', operationId: Option.some('op-make-1') })),
      model(({ job }) => expect(job).toEqual(Job.Failed({ problem: 'failed' }))),
      message(Message.SubmittedMake()),
      Command.expectExact(
        AskForPictures({
          boardId,
          kind: 'picture',
          prompt: 'a red coat in the snow',
          operationId: Option.some('op-make-1'),
        }),
      ),
      Command.resolve(AskForPictures, Message.FailedAsk({ problem: 'dailyLimit', operationId: Option.none() })),
      model(({ job, operationId }) => {
        expect(job).toEqual(Job.Failed({ problem: 'dailyLimit' }))
        expect(operationId).toEqual(Option.none())
      }),
    )
  })

  test('another kind starts a new operation, and polls that keep failing stop with a problem', () => {
    const asking = modifyFields(init(boardId), {
      operationId: () => Option.some('op-make-1'),
      job: () => Job.Running({ generation: generation('drawing', ['waiting']) }),
    })
    story(
      update,
      given(asking),
      ...choseOnePicture,
      model(({ operationId }) => expect(operationId).toEqual(Option.none())),
      message(Message.FailedPoll({ generationId })),
      ...Array.from({ length: 4 }, () =>
        Command.resolve(PollGeneration({ generationId }), Message.FailedPoll({ generationId })),
      ),
      model(({ job }) => expect(job).toEqual(Job.Failed({ problem: 'failed' }))),
    )
  })

  test('a board opened again follows the ask still being made, and only when nothing else is followed', () => {
    story(
      update,
      given(init(boardId)),
      message(Message.SucceededFindRunning({ generation: generation('drawing', ['drawn', 'waiting', 'waiting']) })),
      model(({ job }) => expect(Job.guards.Running(job)).toBe(true)),
      Command.resolve(
        PollGeneration({ generationId }),
        Message.SucceededPoll({ generation: generation('done', ['drawn', 'drawn', 'drawn']) }),
      ),
      model(({ job }) => expect(Job.guards.Finished(job)).toBe(true)),
      expectOutMessage({ _tag: 'FinishedMaking' }),
    )
    story(
      update,
      given(init(boardId)),
      message(Message.SucceededFindRunning({ generation: null })),
      model(({ job }) => expect(Job.guards.Idle(job)).toBe(true)),
    )
    const asking = modifyFields(init(boardId), { job: () => Job.Asking() })
    story(
      update,
      given(asking),
      message(Message.SucceededFindRunning({ generation: generation('planning', []) })),
      model(({ job }) => expect(Job.guards.Asking(job)).toBe(true)),
    )
  })

  test('two letters ask for nothing', () => {
    story(
      update,
      given(init(boardId)),
      message(Message.ChangedWords({ words: 'ab' })),
      message(Message.SubmittedMake()),
      model(({ job }) => expect(Job.guards.Idle(job)).toBe(true)),
    )
  })
})
