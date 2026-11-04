import { StyleNoteId, type Taste } from '@styld/protocol'
import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  Choosing,
  init,
  Message,
  ReadTaste,
  RemoveNote,
  SaveOccasions,
  shownOccasions,
  TasteData,
  update,
} from '../src/page/Taste.ts'

// What Styld knows about you, on the Account page (owner, 4 November 2026): the occasions change at a tap and save at
// once, a note goes when removed, and what is shown stays while it is read again or a change fails.

const heels = StyleNoteId.make(`sn_${'heels'.padEnd(22, 'x')}`)
const office = StyleNoteId.make(`sn_${'office'.padEnd(22, 'x')}`)

const taste: Taste = {
  showMe: null,
  occasions: ['casual'],
  firstRunDone: true,
  notes: [
    { id: heels, text: 'Never heels', createdAt: '2026-11-04T10:00:00.000Z' },
    { id: office, text: 'Office on weekdays', createdAt: '2026-11-04T10:01:00.000Z' },
  ],
  learned: { aesthetics: [], colours: ['navy'], wornTypes: ['jeans'] },
}

const read = modifyFields(init(), { taste: () => TasteData.Success({ data: taste }) })

describe('what Styld knows about you', () => {
  test('a tap adds an occasion in the app’s order and saves it; another tap waits for it', () => {
    story(
      update,
      given(read),
      message(Message.ClickedOccasion({ occasion: 'smart' })),
      Command.expectExact(SaveOccasions({ occasions: ['casual', 'smart'] })),
      model((current) => {
        expect(shownOccasions(current)).toEqual(['casual', 'smart'])
        // Another tap while it saves waits for it.
        expect(update(current, Message.ClickedOccasion({ occasion: 'sport' })).commands ?? []).toEqual([])
      }),
      Command.resolve(
        SaveOccasions,
        Message.SucceededSaveOccasions({ taste: { ...taste, occasions: ['casual', 'smart'] } }),
      ),
      model((current) => {
        expect(shownOccasions(current)).toEqual(['casual', 'smart'])
        expect(Choosing.guards.Idle(current.choosing)).toBe(true)
      }),
    )
  })

  test('a change that did not save says so and shows what is saved', () => {
    story(
      update,
      given(read),
      message(Message.ClickedOccasion({ occasion: 'casual' })),
      Command.expectExact(SaveOccasions({ occasions: [] })),
      Command.resolve(SaveOccasions, Message.FailedSaveOccasions()),
      model((current) => {
        expect(Choosing.guards.Failed(current.choosing)).toBe(true)
        expect(shownOccasions(current)).toEqual(['casual'])
      }),
    )
  })

  test('a removed note goes; one remove at a time', () => {
    story(
      update,
      given(read),
      message(Message.ClickedRemoveNote({ noteId: heels })),
      Command.expectExact(RemoveNote({ noteId: heels })),
      model((current) =>
        expect(update(current, Message.ClickedRemoveNote({ noteId: office })).commands ?? []).toEqual([]),
      ),
      Command.resolve(RemoveNote, Message.SucceededRemoveNote({ noteId: heels })),
      model((current) => {
        const notes = Option.match(AsyncData.getData(current.taste), { onNone: () => [], onSome: (data) => data.notes })
        expect(notes.map(({ text }) => text)).toEqual(['Office on weekdays'])
      }),
    )
  })

  test('a failed read keeps what is shown, and Try again reads again', () => {
    story(
      update,
      given(init()),
      message(Message.FailedReadTaste()),
      message(Message.ClickedRetry()),
      Command.expectExact(ReadTaste()),
      Command.resolve(ReadTaste, Message.SucceededReadTaste({ taste })),
      model((current) => expect(shownOccasions(current)).toEqual(['casual'])),
    )
  })
})
