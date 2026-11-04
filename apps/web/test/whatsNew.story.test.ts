import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import { describe, expect, test } from 'vitest'
import { feedOf } from './WhatsNewFixtures.ts'
import { enter, FeedData, FocusItem, init, Message, More, ReadFeed, ReadMore, update } from '../src/page/WhatsNew.ts'

// What's new reads its first page on Home's entry, keeps it while it is read again, and reads the next page once as
// the list's end nears the screen or Show more is tapped; a page that comes late or twice changes nothing.

const shown = (ids: ReadonlyArray<string>, cursor: string | null) =>
  update(init(), Message.SucceededReadFeed({ feed: feedOf(ids, cursor) })).model

const names = (commands: ReadonlyArray<{ readonly name: string }> | undefined) =>
  (commands ?? []).map(({ name }) => name)

describe("What's new", () => {
  test('a first visit reads the newest; a visit after keeps them on screen while they are read again', () => {
    const first = enter(init())
    expect(names(first.commands)).toEqual([ReadFeed.name])
    const again = enter(shown(['a'], null))
    expect(names(again.commands)).toEqual([ReadFeed.name])
    expect(again.model.feed).toEqual(FeedData.Refreshing({ data: feedOf(['a'], null) }))
  })

  test('nearing the end reads the next page once, and a page for another cursor is not asked for', () => {
    const model = shown(['a', 'b'], 'c1')
    const reached = update(model, Message.ReachedListEnd({ cursor: 'c1' }))
    expect(reached.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: ReadMore.name, args: { cursor: 'c1' } },
    ])
    expect(update(reached.model, Message.ReachedListEnd({ cursor: 'c1' })).commands ?? []).toEqual([])
    expect(update(model, Message.ReachedListEnd({ cursor: 'old' })).commands ?? []).toEqual([])
  })

  test('the next page joins the list with nothing twice, and its cursor is next; a late page changes nothing', () => {
    const asked = update(shown(['a', 'b'], 'c1'), Message.ReachedListEnd({ cursor: 'c1' })).model
    const grown = update(asked, Message.SucceededReadMore({ cursor: 'c1', feed: feedOf(['b', 'c'], null) })).model
    const data = AsyncData.getData(grown.feed)
    expect(Option.map(data, ({ items }) => items.length)).toEqual(Option.some(3))
    expect(Option.map(data, ({ cursor }) => cursor)).toEqual(Option.some(null))
    expect(More.guards.Idle(grown.more)).toBe(true)
    expect(update(grown, Message.SucceededReadMore({ cursor: 'c1', feed: feedOf(['d'], null) })).model).toEqual(grown)
  })

  test('a failed page waits for Show more instead of asking again on its own, and Show more moves focus on', () => {
    const asked = update(shown(['a'], 'c1'), Message.ReachedListEnd({ cursor: 'c1' })).model
    const failed = update(asked, Message.FailedReadMore({ cursor: 'c1' })).model
    expect(failed.more).toEqual(More.Failed({ cursor: 'c1' }))
    expect(update(failed, Message.ReachedListEnd({ cursor: 'c1' })).commands ?? []).toEqual([])
    const retried = update(failed, Message.ClickedShowMore({ cursor: 'c1' }))
    expect(names(retried.commands)).toEqual([ReadMore.name])
    const came = update(retried.model, Message.SucceededReadMore({ cursor: 'c1', feed: feedOf(['z'], null) }))
    expect(came.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: FocusItem.name, args: { key: `board-bd_${'z'.padEnd(22, 'x')}` } },
    ])
  })
})
