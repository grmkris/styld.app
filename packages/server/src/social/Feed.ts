import { boardPins, boards, boardTags, follows, looks } from '@styld/db'
import { type Audience, type Author, type FeedItem, type PublicBoard, Unavailable } from '@styld/protocol'
import { and, desc, eq, exists, gt, inArray, isNotNull, lt, ne, not, or, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { Array, DateTime, Effect, Option } from 'effect'
import { Database, query } from '../kernel/Db.ts'
import { Checks } from '../safety/Checks.ts'
import { PublicPages, summaryOf } from './Public.ts'
import { otherAudience, preferencesOf } from './ShowMe.ts'
import { SocialStore } from './SocialStore.ts'
import { visibleAt } from './Visibility.ts'

// What's new (Eva's Home, owner 4 November): everyone's public things, newest first, the people the reader follows
// first on each page; with Show me (owner, 4 November), in bands: the boards for the reader's choice first. A query, not a table of its own: a second writer of what is public would have to follow every
// unpublish, failed check and block. Three bounded reads, gated as discovery is (a passed check, not an unsure one,
// for the thing and its owner's profile, and no profile three people reported), then read through the public pages'
// rules for this reader (blocks, a published profile), merged by time and interleaved so nobody fills a page.

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
  /** The band of the reader's Show me it was read in. */
  readonly band: number
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
 * came and interleaved on its own, so following someone puts their new things at the top.
 * @internal Exported for its tests. */
export const followedFirst = <A>(
  items: ReadonlyArray<A>,
  followed: ReadonlySet<string>,
  personOf: (item: A) => string,
): Array<A> => {
  const theirs = items.filter((item) => followed.has(personOf(item)))
  const others = items.filter((item) => !followed.has(personOf(item)))
  return [...interleaved(theirs, personOf), ...interleaved(others, personOf)]
}

/** Where a page of What's new starts: in a band of the reader's Show me (one band when nothing was chosen), after the
 * item at `at` with `id`. */
interface Position {
  readonly band: number
  readonly at: Date
  readonly id: string
}

const top = (band: number): Position => ({ band, at: new Date(8.64e15), id: '' })

const positionPattern = /^([0-2])~(.+)~([A-Za-z0-9_-]*)$/u

/** A page's cursor: its band, and the last item read.
 * @internal Exported for its tests. */
export const cursorOf = ({ band, at, id }: Position) => `${String(band)}~${at.toISOString()}~${id}`

/** The page a cursor asks for; none, or one that does not read, is the first page.
 * @internal Exported for its tests. */
export const positionOf = (cursor: string | undefined): Position => {
  const [, band, at, id] = positionPattern.exec(cursor ?? '') ?? []
  const instant = Option.flatMap(Option.fromNullishOr(at), DateTime.make)
  if (band === undefined || id === undefined || Option.isNone(instant)) return top(0)
  return { band: Number(band), at: DateTime.toDateUtc(instant.value), id }
}

/** One band of What's new: which public boards are in it, and whose pins and shared looks (pins and looks rank with
 * the boards for everyone, the followed people's with the first). */
interface Band {
  readonly boards: SQL | undefined
  readonly people: 'any' | 'followed' | 'others' | 'none'
}

/** The band of a reader who chose nothing, or Everything: every public thing, everyone's.
 * @internal Exported for its tests. */
export const everyone: Band = { boards: undefined, people: 'any' }

/** The bands of a reader's Show me (owner, 4 November 2026): the people they follow and the boards for their choice
 * first, then the boards for everyone or nobody in particular with everyone's pins and looks, then the boards for the
 * others. Nothing is left out.
 * @internal Exported for its tests. */
export const bandsFor = (db: Database['Service'], viewer: string, choice: Audience | null): ReadonlyArray<Band> => {
  if (choice === null || choice === 'all') return [everyone]
  const followees = db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, viewer))
  const followed = inArray(boards.accountId, followees)
  const tagged = (audience: Audience) =>
    exists(
      db
        .select({ id: boardTags.boardId })
        .from(boardTags)
        .where(and(eq(boardTags.boardId, boards.id), eq(boardTags.kind, 'audience'), eq(boardTags.value, audience))),
    )
  const other = otherAudience(choice)
  return [
    { boards: or(followed, tagged(choice)), people: 'followed' },
    { boards: and(not(followed), not(tagged(choice)), not(tagged(other))), people: 'others' },
    { boards: and(not(followed), tagged(other)), people: 'none' },
  ]
}

/** Whose pins or looks a band takes, by the column of their owner. */
const ofPeople = (db: Database['Service'], viewer: string, band: Band, owner: SQLiteColumn) => {
  const followees = db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, viewer))
  if (band.people === 'followed') return inArray(owner, followees)
  if (band.people === 'others') return not(inArray(owner, followees))
  return undefined
}

/** Strictly after the position, newest first: an earlier instant, or the same instant and a smaller id. */
const after = (at: SQLiteColumn, id: SQLiteColumn, position: Position) =>
  or(lt(at, position.at), and(eq(at, position.at), lt(id, position.id)))

/** The newest things in one band that anyone but the reader made public after `position`: boards that went public,
 * pins added to a board after it went public (a board's own pins come with it, not one by one), and shared looks.
 * @internal Exported for its tests. */
export const candidates = (db: Database['Service'], viewer: string, position: Position, band: Band) =>
  Effect.gen(function* () {
    const went = yield* read(() =>
      db
        .select({ id: boards.id, accountId: boards.accountId, at: boards.publishedAt })
        .from(boards)
        .where(
          and(
            eq(boards.visibility, 'public'),
            after(boards.publishedAt, boards.id, position),
            ne(boards.accountId, viewer),
            band.boards,
          ),
        )
        .orderBy(desc(boards.publishedAt), desc(boards.id))
        .limit(pageSize),
    )
    const pinned =
      band.people === 'none'
        ? []
        : yield* read(() =>
            db
              .select({ id: boardPins.id, boardId: boards.id, accountId: boards.accountId, at: boardPins.createdAt })
              .from(boards)
              .innerJoin(boardPins, eq(boardPins.boardId, boards.id))
              .where(
                and(
                  eq(boards.visibility, 'public'),
                  ne(boards.accountId, viewer),
                  gt(boardPins.createdAt, boards.publishedAt),
                  after(boardPins.createdAt, boardPins.id, position),
                  ofPeople(db, viewer, band, boards.accountId),
                ),
              )
              .orderBy(desc(boardPins.createdAt), desc(boardPins.id))
              .limit(pageSize),
          )
    const shared =
      band.people === 'none'
        ? []
        : yield* read(() =>
            db
              .select({ id: looks.id, accountId: looks.accountId, at: looks.sharedAt })
              .from(looks)
              .where(
                and(
                  isNotNull(looks.sharedAt),
                  after(looks.sharedAt, looks.id, position),
                  ne(looks.accountId, viewer),
                  ofPeople(db, viewer, band, looks.accountId),
                ),
              )
              .orderBy(desc(looks.sharedAt), desc(looks.id))
              .limit(pageSize),
          )
    const all: ReadonlyArray<Candidate> = [
      ...went.flatMap(({ id, accountId, at }) =>
        at === null ? [] : [{ kind: 'board' as const, id, boardId: id, accountId, at, band: position.band }],
      ),
      ...pinned.map(({ id, boardId, accountId, at }) => ({
        kind: 'pin' as const,
        id,
        boardId,
        accountId,
        at,
        band: position.band,
      })),
      ...shared.flatMap(({ id, accountId, at }) =>
        at === null ? [] : [{ kind: 'look' as const, id, boardId: '', accountId, at, band: position.band }],
      ),
    ]
    return all
      .toSorted((left, right) => right.at.getTime() - left.at.getTime() || (left.id < right.id ? 1 : -1))
      .slice(0, pageSize)
  })

/** A page from `start` on: its band first, then the next bands from their top, until the page is full; the
 * position after its last item, or none once every band is read.
 * @internal Exported for its tests. */
export const pageFrom = (db: Database['Service'], viewer: string, start: Position, bands: ReadonlyArray<Band>) =>
  Effect.gen(function* () {
    const found: Array<Candidate> = []
    for (let band = start.band; band < bands.length && found.length < pageSize; band += 1) {
      const scope = bands[band]
      if (scope === undefined) break
      const inBand = yield* candidates(db, viewer, band === start.band ? start : top(band), scope)
      found.push(...inBand.slice(0, pageSize - found.length))
    }
    const last = found.at(-1)
    const next = found.length < pageSize || last === undefined ? null : { band: last.band, at: last.at, id: last.id }
    return { found, next }
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

/** What's new for the account, from `cursor` on: the bands of their Show me in turn, each newest first, and on each
 * page the people they follow first within its band. */
export const feedFor = (viewer: string, cursor: string | undefined) =>
  Effect.gen(function* () {
    const social = yield* SocialStore
    const db = yield* Database
    const { showMe } = yield* preferencesOf(db, viewer)
    const { found, next } = yield* pageFrom(db, viewer, positionOf(cursor), bandsFor(db, viewer, showMe))
    const passed = yield* discoverable(yield* Checks, social, found)
    const items = yield* shown(yield* PublicPages, passed, viewer)
    const followed = new Set(yield* social.followees(viewer).pipe(Effect.mapError(unavailable)))
    const bandsOf = [...new Set(items.map(({ candidate }) => candidate.band))]
    return {
      items: bandsOf
        .flatMap((band) =>
          followedFirst(
            items.filter(({ candidate }) => candidate.band === band),
            followed,
            ({ candidate }) => candidate.accountId,
          ),
        )
        .map(({ item }) => item),
      cursor: next === null ? null : cursorOf(next),
    }
  })
