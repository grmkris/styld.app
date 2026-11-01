import { Dialog, RadioGroup } from '@foldkit/ui'
import { Generation } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, expectOutMessage, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'
import { storySheetMoved } from './SheetFixtures.ts'
import { AskToMake, init, Job, kinds, Message, ReadGeneration, subscriptions, update } from '../src/page/Board/Make.ts'

const boardId = `bd_${'sea'.padEnd(22, 'x')}`
const generationId = `gj_${'sea'.padEnd(22, 'x')}`
const generation = (status: string, pictures: ReadonlyArray<string>, kind = 'moodBoard') =>
  Schema.decodeUnknownSync(Generation)({
    id: generationId,
    boardId,
    kind,
    status,
    reason: null,
    sticker:
      pictures[0] === undefined
        ? null
        : { status: pictures[0], imageId: pictures[0] === 'drawn' ? `bm_${'0'.padEnd(22, 'x')}` : null },
    createdAt: '2026-10-31T09:00:00.000Z',
  })

/** What the job's poll waits on. */
const pending = (current: Parameters<typeof update>[0]) =>
  subscriptions.generationWhileRunning.modelToDependencies(current).pendingIds

const choseSticker = [
  message(
    Message.GotKindChoiceMessage({
      message: RadioGroup.Message.SelectedOption({ index: kinds.indexOf('sticker'), value: 'sticker' }),
    }),
  ),
  Command.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption()),
] as const

describe('making a mood board or a sticker for a board', () => {
  test('sends the words as a mood board, follows the job while it runs, and says once it is done', () => {
    story(
      update,
      given(init(boardId)),
      message(Message.ClickedMake()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      ...storySheetMoved(1),
      message(Message.ChangedWords({ words: '  a slow weekend by the sea ' })),
      message(Message.SubmittedMake()),
      Command.expectExact(
        AskToMake({ boardId, kind: 'moodBoard', prompt: 'a slow weekend by the sea', operationId: Option.none() }),
      ),
      Command.resolve(AskToMake, Message.SucceededAsk({ generation: generation('planning', []) })),
      model(({ job, words, sheet }) => {
        expect(Job.guards.Running(job)).toBe(true)
        expect(words).toBe('')
        expect(sheet.isOpen).toBe(false)
      }),
      ...storySheetMoved(2),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      model((current) => expect(pending(current)).toEqual([generationId])),
      message(Message.TickedGenerationRefresh()),
      Command.resolve(
        ReadGeneration({ generationId }),
        Message.SucceededReadGeneration({ generation: generation('arranging', []) }),
      ),
      message(Message.TickedGenerationRefresh()),
      Command.resolve(
        ReadGeneration({ generationId }),
        Message.SucceededReadGeneration({ generation: generation('done', []) }),
      ),
      model(({ job }) => expect(Job.guards.Finished(job)).toBe(true)),
      model((current) => expect(pending(current)).toEqual([])),
      expectOutMessage({ _tag: 'FinishedMaking' }),
    )
  })

  test('a sticker, tried again under the same operation after a failure that may not have arrived', () => {
    story(
      update,
      given(init(boardId)),
      ...choseSticker,
      message(Message.ChangedWords({ words: 'a lemon on a blue plate' })),
      message(Message.SubmittedMake()),
      Command.resolve(AskToMake, Message.FailedAsk({ problem: 'failed', operationId: Option.some('op-make-1') })),
      model(({ job }) => expect(job).toEqual(Job.Failed({ problem: 'failed' }))),
      message(Message.SubmittedMake()),
      Command.expectExact(
        AskToMake({
          boardId,
          kind: 'sticker',
          prompt: 'a lemon on a blue plate',
          operationId: Option.some('op-make-1'),
        }),
      ),
      Command.resolve(AskToMake, Message.FailedAsk({ problem: 'dailyLimit', operationId: Option.none() })),
      model(({ job, operationId }) => {
        expect(job).toEqual(Job.Failed({ problem: 'dailyLimit' }))
        expect(operationId).toEqual(Option.none())
      }),
    )
  })

  test('another kind starts a new operation, and reads that keep failing stop with a problem', () => {
    const asking = modifyFields(init(boardId), {
      operationId: () => Option.some('op-make-1'),
      job: () => Job.Running({ generation: generation('planning', []), read: 'waiting' }),
    })
    const missedRead = [
      message(Message.TickedGenerationRefresh()),
      Command.resolve(ReadGeneration({ generationId }), Message.FailedReadGeneration()),
    ] as const
    story(
      update,
      given(asking),
      ...choseSticker,
      model(({ operationId }) => expect(operationId).toEqual(Option.none())),
      ...missedRead,
      ...missedRead,
      ...missedRead,
      ...missedRead,
      model(({ job }) => expect(Job.guards.Running(job)).toBe(true)),
      ...missedRead,
      model(({ job }) => expect(job).toEqual(Job.Failed({ problem: 'failed' }))),
      model((current) => expect(pending(current)).toEqual([])),
    )
  })

  test('a tick while a read is on its way asks for nothing more, so reads never stack', () => {
    const running = modifyFields(init(boardId), {
      job: () => Job.Running({ generation: generation('planning', []), read: 'waiting' }),
    })
    const reading = update(running, Message.TickedGenerationRefresh())
    expect(reading.commands?.map(({ name }) => name)).toEqual(['ReadGeneration'])
    expect(update(reading.model, Message.TickedGenerationRefresh()).commands ?? []).toEqual([])
  })

  test('a board opened again follows the ask still being made, and only when nothing else is followed', () => {
    story(
      update,
      given(init(boardId)),
      message(Message.CompletedFindRunningGeneration({ generation: generation('drawing', ['waiting'], 'sticker') })),
      model(({ job }) => expect(Job.guards.Running(job)).toBe(true)),
      message(Message.TickedGenerationRefresh()),
      Command.resolve(
        ReadGeneration({ generationId }),
        Message.SucceededReadGeneration({ generation: generation('done', ['drawn'], 'sticker') }),
      ),
      model(({ job }) => expect(Job.guards.Finished(job)).toBe(true)),
      expectOutMessage({ _tag: 'FinishedMaking' }),
    )
    story(
      update,
      given(init(boardId)),
      message(Message.CompletedFindRunningGeneration({ generation: null })),
      model(({ job }) => expect(Job.guards.Idle(job)).toBe(true)),
    )
    const asking = modifyFields(init(boardId), { job: () => Job.Asking() })
    story(
      update,
      given(asking),
      message(Message.CompletedFindRunningGeneration({ generation: generation('planning', []) })),
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
