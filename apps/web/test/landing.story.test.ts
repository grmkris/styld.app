import { Explore } from '@styld/protocol'
import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { BoardsData, enter, init, Message, retry, update } from '../src/page/LandingBoards.ts'

const empty = Schema.decodeUnknownSync(Explore)({ edits: [], featured: [], people: [], newest: [] })

describe('the landing’s boards', () => {
  test('a first visit asks for them; a second while they come does not ask twice', () => {
    const entered = enter(init())
    expect(entered.model.boards).toEqual(BoardsData.Loading())
    expect(entered.commands?.map(({ name }) => name)).toEqual(['LoadLanding'])
    expect(retry(entered.model).commands ?? []).toEqual([])
  })

  test('keeps what it showed while they are read again, and when that read fails', () => {
    const shown = update(init(), Message.SucceededLoadLanding({ explore: empty })).model
    const entered = enter(shown)
    expect(entered.model.boards).toEqual(BoardsData.Refreshing({ data: empty }))
    expect(entered.commands?.map(({ name }) => name)).toEqual(['LoadLanding'])
    const failed = update(entered.model, Message.FailedLoadLanding()).model
    expect(failed.boards).toEqual(BoardsData.Stale({ error: 'Unavailable', data: empty }))
  })
})
