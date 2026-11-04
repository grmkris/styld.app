import { Feed, type FeedItem } from '@styld/protocol'
import { Effect, Match, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Dom, Mount, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { observed } from '../Observe.ts'
import { StyldClient } from '../StyldClient.ts'
import * as Challenges from './Challenges.ts'

// What's new on Home (Eva's sketch, owner 4 November): what everyone made public lately, the people the person
// follows first. The newest few run along a strip under "What to wear today"; the rest follow at the foot of Home,
// and more are read as the person scrolls to the end, or taps Show more.

// MODEL

export const FeedData = AsyncData.Schema(Feed, Schema.Literal('Unavailable'))
export type FeedData = typeof FeedData.schema.Type

/** The next page: none asked for, on its way from a cursor (by the button, so focus follows), or failed there. */
export const More = defineTaggedUnion({
  Idle: {},
  Loading: { cursor: Schema.String, byButton: Schema.Boolean },
  Failed: { cursor: Schema.String },
})
export type More = typeof More.Type

/** With the house boards Eva's challenges open, public boards too, read when Home opens. */
export const Model = Schema.Struct({ feed: FeedData.schema, more: More, challenges: Challenges.Model })
export type Model = typeof Model.Type

export const init = (): Model => ({ feed: AsyncData.Idle(), more: More.Idle(), challenges: Challenges.init() })

/** How many of the newest the strip shows; the rest are "What's new, earlier". */
export const stripLength = 8

/** An item's key, the same for the item however it is read again. */
export const itemKey = (item: FeedItem) =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      BoardWentPublic: ({ board }) => `board-${board.id}`,
      PinnedOnBoard: ({ pin }) => `pin-${pin.id}`,
      SharedLook: ({ look }) => `look-${look.id}`,
    }),
  )

// MESSAGE

export const Message = defineMessageUnion({
  SucceededReadFeed: { feed: Feed },
  FailedReadFeed: {},
  ClickedRetry: {},
  ReachedListEnd: { cursor: Schema.String },
  ClickedShowMore: { cursor: Schema.String },
  SucceededReadMore: { cursor: Schema.String, feed: Feed },
  FailedReadMore: { cursor: Schema.String },
  CompletedFocusItem: {},
  GotChallengesMessage: { message: Challenges.Message },
})
export type Message = typeof Message.Type

// COMMAND

export const ReadFeed = Command.define('ReadFeed', {
  messages: [Message.SucceededReadFeed, Message.FailedReadFeed],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededReadFeed({ feed: yield* api.social.feed({ query: {} }) })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadFeed())),
})

export const ReadMore = Command.define('ReadMore', {
  args: { cursor: Schema.String },
  messages: [Message.SucceededReadMore, Message.FailedReadMore],
  execute: ({ cursor }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      return Message.SucceededReadMore({ cursor, feed: yield* api.social.feed({ query: { cursor } }) })
    }).pipe(Effect.orElseSucceed(() => Message.FailedReadMore({ cursor }))),
})

/** After Show more, focus moves to the first thing it brought, so a keyboard carries on where the list grew. */
export const FocusItem = Command.define('FocusItem', {
  args: { key: Schema.String },
  messages: [Message.CompletedFocusItem],
  execute: ({ key }) =>
    Dom.focus(`#whats-new-${key} a`, { preventScroll: false }).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusItem()),
    ),
})

// MOUNT

/** Says when the end of the list comes near the screen, so the next page is read before the person reaches it. A new
 * sentinel per cursor, so a page too short to fill the screen still asks for the next. */
export const WatchListEnd = Mount.defineStream('WatchListEnd', {
  args: { cursor: Schema.String },
  messages: [Message.ReachedListEnd],
  execute: ({ element, cursor }) =>
    observed<typeof Message.ReachedListEnd.Type>(
      element,
      (offer) =>
        new IntersectionObserver(
          (entries) => {
            if (entries.some(({ isIntersecting }) => isIntersecting)) {
              offer(Message.ReachedListEnd({ cursor }))
            }
          },
          { rootMargin: '0px 0px 600px 0px' },
        ),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const unavailable = Result.fail('Unavailable' as const)

const challengesFold = {
  read: (model: Model) => Option.some(model.challenges),
  write: (model: Model, challenges: Challenges.Model) => modifyFields(model, { challenges: () => challenges }),
  toParentMessage: (message: Challenges.Message) => Message.GotChallengesMessage({ message }),
}

/** The newest read again, what was shown staying meanwhile; a first visit reads them. */
export const refresh = (model: Model): UpdateReturn =>
  Update.refresh<Model, Message, Feed, 'Unavailable', StyldClient>({
    read: (current: Model) => Option.some(current.feed),
    revalidate: AsyncData.revalidateOrLoad,
    write: (current: Model, feed: FeedData) => modifyFields(current, { feed: () => feed }),
    load: ReadFeed(),
  })(model)

/** Opening Home: the newest, and the boards of the challenges beside them. */
export const enter = (model: Model): UpdateReturn =>
  Update.combine<Model, Message, StyldClient>(model, [
    refresh,
    Update.foldChildStep({ update: Challenges.enter, ...challengesFold }),
  ])

/** The next page from `cursor`, when it is the list's own next page and none is on its way. */
const readMore = (model: Model, cursor: string, byButton: boolean): UpdateReturn => {
  const next = Option.flatMap(AsyncData.getData(model.feed), (feed) => Option.fromNullishOr(feed.cursor))
  if (!Option.contains(next, cursor) || More.guards.Loading(model.more)) {
    return { model }
  }
  return {
    model: modifyFields(model, { more: () => More.Loading({ cursor, byButton }) }),
    commands: [ReadMore({ cursor })],
  }
}

/** A page that came for the cursor still awaited: its items join the list (none twice), and its cursor is next. */
const gotMore = (model: Model, cursor: string, page: Feed): UpdateReturn => {
  const awaited = More.guards.Loading(model.more) && model.more.cursor === cursor
  const current = AsyncData.getData(model.feed)
  if (!awaited || Option.isNone(current) || current.value.cursor !== cursor) {
    return { model }
  }
  const known = new Set(current.value.items.map(itemKey))
  const added = page.items.filter((item) => !known.has(itemKey(item)))
  const byButton = More.guards.Loading(model.more) && model.more.byButton
  const grown = modifyFields(model, {
    feed: () => FeedData.Success({ data: { items: [...current.value.items, ...added], cursor: page.cursor } }),
    more: () => More.Idle(),
  })
  return Option.match(Option.fromNullishOr(added[0]), {
    onNone: () => ({ model: grown }),
    onSome: (first) => (byButton ? { model: grown, commands: [FocusItem({ key: itemKey(first) })] } : { model: grown }),
  })
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededReadFeed: ({ feed }) => ({
      model: modifyFields(model, { feed: () => FeedData.Success({ data: feed }), more: () => More.Idle() }),
    }),
    FailedReadFeed: () => ({ model: modifyFields(model, { feed: (feed) => AsyncData.settle(feed, unavailable) }) }),
    ClickedRetry: () => refresh(model),
    ReachedListEnd: ({ cursor }) => (More.guards.Failed(model.more) ? { model } : readMore(model, cursor, false)),
    ClickedShowMore: ({ cursor }) => readMore(model, cursor, true),
    SucceededReadMore: ({ cursor, feed }) => gotMore(model, cursor, feed),
    FailedReadMore: ({ cursor }) => ({
      model:
        More.guards.Loading(model.more) && model.more.cursor === cursor
          ? modifyFields(model, { more: () => More.Failed({ cursor }) })
          : model,
    }),
    CompletedFocusItem: () => ({ model }),
    GotChallengesMessage: (got) =>
      Update.foldChild({ update: Challenges.update, ...challengesFold })(model, got.message),
  })
