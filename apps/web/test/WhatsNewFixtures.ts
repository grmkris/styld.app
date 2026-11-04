import { Feed } from '@styld/protocol'
import { Schema } from 'effect'

// What's new's items for the stories and scenes: boards gone public, one per id.

/** A board gone public by someone, at an instant. */
export const boardItem = (id: string, handle = 'nika.kovac') => ({
  _tag: 'BoardWentPublic',
  board: {
    id: `bd_${id.padEnd(22, 'x')}`,
    name: `Board ${id}`,
    paper: 'sand',
    items: [],
    cover: [],
    pinCount: 0,
    publishedAt: '2026-11-04T08:00:00.000Z',
  },
  by: { handle, name: handle, tone: 'clay' },
  at: '2026-11-04T08:00:00.000Z',
})

export const feedOf = (ids: ReadonlyArray<string>, cursor: string | null) =>
  Schema.decodeUnknownSync(Feed)({ items: ids.map((id) => boardItem(id)), cursor })
