import { boardPins, boards, looks } from '@styld/db'
import { type Author, type FeedItem, Unavailable } from '@styld/protocol'
import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { Array, DateTime, Effect, Option } from 'effect'
import { type Database, query } from '../kernel/Db.ts'
import type { Checks } from '../safety/Checks.ts'
import { type PublicPages, summaryOf } from './Public.ts'
import type { SocialStore } from './SocialStore.ts'
import { visibleAt } from './Visibility.ts'

// The Following feed is a query over follows, not a table of its own: a second writer of what is public would have to
// follow every unpublish, failed check and block. Three bounded reads, newest first, each gated as discovery is (a
// passed check, not an unsure one), merged by time and interleaved so nobody fills it.

/** Items a page of the feed shows, and how many of one person's in a row at most. */
const pageSize = 20
const maxRun = 2

const unavailable = () => Unavailable.make({})
/** A D1 read; a store that does not answer is unavailable. */
const read = <A>(run: () => Promise<A>) => query(run).pipe(Effect.mapError(unavailable))

interface Candidate {
  readonly kind: 'board' | 'pin' | 'look'
  readonly id: string
  readonly boardId: string
  readonly accountId: string
  readonly at: Date
}

/** Reorder so that no more than `run` items of one person come in a row, keeping the order otherwise. */
const interleaved = <A>(items: ReadonlyArray<A>, personOf: (item: A) => string, run = maxRun): Array<A> => {
  const waiting = [...items]
  const placed: Array<A> = []
  while (waiting.length > 0) {
    const last = placed.slice(-run).map(personOf)
    const full = last.length === run && last.every((person) => person === last[0])
    const index = full ? waiting.findIndex((item) => personOf(item) !== last[0]) : 0
    const [next] = waiting.splice(index === -1 ? 0 : index, 1)
    if (next !== undefined) placed.push(next)
  }
  return placed
}

/** D1 binds at most 100 parameters to a statement: the people followed go in groups well under it. */
const peoplePerQuery = 80

/** The newest things from the people followed, before `before`, across every group of them. */
const candidates = (db: Database['Service'], people: ReadonlyArray<string>, before: Date) =>
  Effect.map(
    Effect.forEach(Array.chunksOf(people, peoplePerQuery), (group) => candidatesOf(db, group, before)),
    (groups) =>
      groups
        .flat()
        .toSorted((left, right) => right.at.getTime() - left.at.getTime())
        .slice(0, pageSize),
  )

const candidatesOf = (db: Database['Service'], people: ReadonlyArray<string>, before: Date) =>
  Effect.gen(function* () {
    const ids = [...people]
    const went = yield* read(() =>
      db
        .select({ id: boards.id, accountId: boards.accountId, at: boards.publishedAt })
        .from(boards)
        .where(and(inArray(boards.accountId, ids), eq(boards.visibility, 'public'), lt(boards.publishedAt, before)))
        .orderBy(desc(boards.publishedAt))
        .limit(pageSize),
    )
    const pinned = yield* read(() =>
      db
        .select({ id: boardPins.id, boardId: boards.id, accountId: boards.accountId, at: boardPins.createdAt })
        .from(boardPins)
        .innerJoin(boards, eq(boards.id, boardPins.boardId))
        .where(and(inArray(boards.accountId, ids), eq(boards.visibility, 'public'), lt(boardPins.createdAt, before)))
        .orderBy(desc(boardPins.createdAt))
        .limit(pageSize),
    )
    const shared = yield* read(() =>
      db
        .select({ id: looks.id, accountId: looks.accountId, at: looks.sharedAt })
        .from(looks)
        .where(and(inArray(looks.accountId, ids), isNotNull(looks.sharedAt), lt(looks.sharedAt, before)))
        .orderBy(desc(looks.sharedAt))
        .limit(pageSize),
    )
    const all: ReadonlyArray<Candidate> = [
      ...went.flatMap(({ id, accountId, at }) =>
        at === null ? [] : [{ kind: 'board' as const, id, boardId: id, accountId, at }],
      ),
      ...pinned.map(({ id, boardId, accountId, at }) => ({ kind: 'pin' as const, id, boardId, accountId, at })),
      ...shared.flatMap(({ id, accountId, at }) =>
        at === null ? [] : [{ kind: 'look' as const, id, boardId: '', accountId, at }],
      ),
    ]
    return all.toSorted((left, right) => right.at.getTime() - left.at.getTime()).slice(0, pageSize)
  })

/** The feed's page for the account, from `cursor` (an instant) back. */
export const feedFor = (
  services: {
    readonly db: Database['Service']
    readonly pages: PublicPages['Service']
    readonly social: SocialStore
    readonly checks: Checks['Service']
  },
  viewer: string,
  cursor: string | undefined,
) =>
  Effect.gen(function* () {
    const followed = yield* services.social.followees(viewer).pipe(Effect.mapError(unavailable))
    const blocked = yield* services.social.blockedAmong(viewer, followed).pipe(Effect.mapError(unavailable))
    const people = followed.filter((accountId) => !blocked.has(accountId))
    if (people.length === 0) return { items: [], cursor: null }
    const parsed = cursor === undefined ? Option.none() : DateTime.make(cursor)
    const before = Option.match(parsed, { onNone: () => new Date(8.64e15), onSome: DateTime.toDateUtc })
    const found = yield* candidates(services.db, people, before)
    const passed = yield* passedOnly(services.checks, found)
    const items = yield* Effect.forEach(passed, (candidate) => shown(services.pages, candidate, viewer), {
      concurrency: 8,
    })
    const kept = items.flatMap(Option.toArray)
    const last = found.at(-1)
    return {
      items: interleaved(kept, ({ by }) => by.handle),
      cursor: found.length < pageSize || last === undefined ? null : last.at.toISOString(),
    }
  })

const passedOnly = (checks: Checks['Service'], found: ReadonlyArray<Candidate>) =>
  Effect.gen(function* () {
    const ids = (kind: 'board' | 'look') =>
      found
        .filter((candidate) =>
          kind === 'board' ? candidate.kind === 'board' || candidate.kind === 'pin' : candidate.kind === kind,
        )
        .map((candidate) => (kind === 'board' ? candidate.boardId : candidate.id))
    const boardChecks = yield* checks.statuses('board', ids('board'))
    const lookChecks = yield* checks.statuses('look', ids('look'))
    return found.filter((candidate) =>
      visibleAt(
        'discovery',
        candidate.kind === 'look' ? lookChecks.get(candidate.id) : boardChecks.get(candidate.boardId),
      ),
    )
  })

/** One candidate as the feed shows it, read through the public pages' rules for this viewer. */
const shown = (pages: PublicPages['Service'], candidate: Candidate, viewer: string) => {
  const at = candidate.at.toISOString()
  const reader = Option.some(viewer)
  const item: Effect.Effect<FeedItem | undefined, unknown> =
    candidate.kind === 'look'
      ? Effect.map(pages.look(candidate.id, reader), ({ look, by }): FeedItem => ({ _tag: 'SharedLook', look, by, at }))
      : Effect.map(pages.board(candidate.boardId, reader), (board): FeedItem | undefined => {
          const by: Author = board.by
          if (candidate.kind === 'board')
            return {
              _tag: 'BoardWentPublic',
              board: summaryOf(board),
              by,
              at,
            }
          const pin = board.pins.find(({ id }) => id === candidate.id)
          return pin === undefined
            ? undefined
            : { _tag: 'PinnedOnBoard', pin, boardId: board.id, boardName: board.name, by, at }
        })
  return item.pipe(
    Effect.map(Option.fromNullishOr),
    Effect.orElseSucceed(() => Option.none<FeedItem>()),
  )
}
