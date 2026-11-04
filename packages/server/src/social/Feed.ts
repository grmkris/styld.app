import { boardPins, boards, looks } from '@styld/db'
import { type Author, type FeedItem, type PublicBoard, Unavailable } from '@styld/protocol'
import { and, desc, eq, gt, isNotNull, lt, ne } from 'drizzle-orm'
import { Array, DateTime, Effect, Option } from 'effect'
import { Database, query } from '../kernel/Db.ts'
import { Checks } from '../safety/Checks.ts'
import { PublicPages, summaryOf } from './Public.ts'
import { SocialStore } from './SocialStore.ts'
import { visibleAt } from './Visibility.ts'

// What's new (Eva's Home, owner 4 November): everyone's public things, newest first, the people the reader follows
// first on each page. A query, not a table of its own: a second writer of what is public would have to follow every
// unpublish, failed check and block. Three bounded reads, gated as discovery is (a passed check, not an unsure one,
// for the thing and its owner's profile, and no profile three people reported), then read through the public pages'
// rules for this reader (blocks, a published profile), merged by time and interleaved so nobody fills a page.

/** Items a page of the feed shows, and how many of one person's in a row at most. */
const pageSize = 20
const maxRun = 2

const unavailable = () => Unavailable.make({})
/** A D1 read; a store that does not answer is unavailable. */
const read = <A>(run: () => Promise<A>) => query(run).pipe(Effect.mapError(unavailable))

export interface Candidate {
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

/** A page in reading order: the followed people's items first, then everyone else's, each part newest first as it
 * came and interleaved on its own, so following someone puts their new things at the top. */
export const followedFirst = <A>(
  items: ReadonlyArray<A>,
  followed: ReadonlySet<string>,
  personOf: (item: A) => string,
): Array<A> => {
  const theirs = items.filter((item) => followed.has(personOf(item)))
  const others = items.filter((item) => !followed.has(personOf(item)))
  return [...interleaved(theirs, personOf), ...interleaved(others, personOf)]
}

/** The newest things anyone but the reader made public before `before`: boards that went public, pins added to a
 * board after it went public (a board's own pins come with it, not one by one), and shared looks. */
export const candidates = (db: Database['Service'], viewer: string, before: Date) =>
  Effect.gen(function* () {
    const went = yield* read(() =>
      db
        .select({ id: boards.id, accountId: boards.accountId, at: boards.publishedAt })
        .from(boards)
        .where(and(eq(boards.visibility, 'public'), lt(boards.publishedAt, before), ne(boards.accountId, viewer)))
        .orderBy(desc(boards.publishedAt))
        .limit(pageSize),
    )
    const pinned = yield* read(() =>
      db
        .select({ id: boardPins.id, boardId: boards.id, accountId: boards.accountId, at: boardPins.createdAt })
        .from(boards)
        .innerJoin(boardPins, eq(boardPins.boardId, boards.id))
        .where(
          and(
            eq(boards.visibility, 'public'),
            lt(boards.publishedAt, before),
            ne(boards.accountId, viewer),
            gt(boardPins.createdAt, boards.publishedAt),
            lt(boardPins.createdAt, before),
          ),
        )
        .orderBy(desc(boardPins.createdAt))
        .limit(pageSize),
    )
    const shared = yield* read(() =>
      db
        .select({ id: looks.id, accountId: looks.accountId, at: looks.sharedAt })
        .from(looks)
        .where(and(isNotNull(looks.sharedAt), lt(looks.sharedAt, before), ne(looks.accountId, viewer)))
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

/** The candidates discovery may show: the owner's profile and the thing itself passed Styld's check (an unsure one
 * stays at its own link), and no profile three people reported. */
const discoverable = (checks: Checks['Service'], social: SocialStore['Service'], found: ReadonlyArray<Candidate>) =>
  Effect.gen(function* () {
    const owners = [...new Set(found.map(({ accountId }) => accountId))]
    const reported = yield* social.reportedProfiles(owners).pipe(Effect.mapError(unavailable))
    const profileChecks = yield* checks.statuses('profile', owners)
    const ids = (kind: 'board' | 'look') =>
      found
        .filter((candidate) => (kind === 'look') === (candidate.kind === 'look'))
        .map((candidate) => (kind === 'board' ? candidate.boardId : candidate.id))
    const boardChecks = yield* checks.statuses('board', ids('board'))
    const lookChecks = yield* checks.statuses('look', ids('look'))
    return found.filter(
      (candidate) =>
        !reported.has(candidate.accountId) &&
        visibleAt('discovery', profileChecks.get(candidate.accountId)) &&
        visibleAt(
          'discovery',
          candidate.kind === 'look' ? lookChecks.get(candidate.id) : boardChecks.get(candidate.boardId),
        ),
    )
  })

/** A candidate as the feed shows it, from its board as this reader may see it (read once for all its pins). */
const fromBoard = (candidate: Candidate, board: PublicBoard): FeedItem | undefined => {
  const at = candidate.at.toISOString()
  const by: Author = board.by
  if (candidate.kind === 'board') return { _tag: 'BoardWentPublic', board: summaryOf(board), by, at }
  const pin = board.pins.find(({ id }) => id === candidate.id)
  return pin === undefined
    ? undefined
    : { _tag: 'PinnedOnBoard', pin, boardId: board.id, boardName: board.name, by, at }
}

/** Every candidate as the feed shows it, read through the public pages' rules for this reader: a board or look they
 * may not see (a block, an unpublished profile) drops out. */
const shown = (pages: PublicPages['Service'], passed: ReadonlyArray<Candidate>, viewer: string) =>
  Effect.gen(function* () {
    const reader = Option.some(viewer)
    const boardIds = [...new Set(passed.filter(({ kind }) => kind !== 'look').map(({ boardId }) => boardId))]
    const boardsRead = yield* Effect.forEach(
      boardIds,
      (boardId) =>
        pages.board(boardId, reader).pipe(
          Effect.map((board) => [boardId, Option.some(board)] as const),
          Effect.orElseSucceed(() => [boardId, Option.none<PublicBoard>()] as const),
        ),
      { concurrency: 8 },
    )
    const byBoard = new Map(boardsRead)
    const items = yield* Effect.forEach(
      passed,
      (candidate): Effect.Effect<Option.Option<FeedItem>> =>
        candidate.kind === 'look'
          ? pages.look(candidate.id, reader).pipe(
              Effect.map(({ look, by }) =>
                Option.some<FeedItem>({ _tag: 'SharedLook', look, by, at: candidate.at.toISOString() }),
              ),
              Effect.orElseSucceed(() => Option.none<FeedItem>()),
            )
          : Effect.succeed(
              Option.flatMap(Option.fromNullishOr(byBoard.get(candidate.boardId)), (board) =>
                Option.flatMap(board, (seen) => Option.fromNullishOr(fromBoard(candidate, seen))),
              ),
            ),
      { concurrency: 8 },
    )
    return passed.flatMap((candidate, index) =>
      Option.toArray(Option.map(Option.flatten(Option.fromNullishOr(items[index])), (item) => ({ candidate, item }))),
    )
  })

/** What's new for the account, from `cursor` (an instant) back. */
export const feedFor = (viewer: string, cursor: string | undefined) =>
  Effect.gen(function* () {
    const social = yield* SocialStore
    const parsed = cursor === undefined ? Option.none() : DateTime.make(cursor)
    const before = Option.match(parsed, { onNone: () => new Date(8.64e15), onSome: DateTime.toDateUtc })
    const found = yield* candidates(yield* Database, viewer, before)
    const passed = yield* discoverable(yield* Checks, social, found)
    const items = yield* shown(yield* PublicPages, passed, viewer)
    const followed = new Set(yield* social.followees(viewer).pipe(Effect.mapError(unavailable)))
    const last = found.at(-1)
    return {
      items: followedFirst(items, followed, ({ candidate }) => candidate.accountId).map(({ item }) => item),
      cursor: found.length < pageSize || last === undefined ? null : last.at.toISOString(),
    }
  })
