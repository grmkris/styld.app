import { boards, follows, profiles, reports } from '@styld/db'
import {
  type Author,
  type Explore,
  type FoundBoard,
  Mood,
  reportsToHide,
  type SearchResults,
  stem,
  type SuggestedPerson,
  Unavailable,
  wordsIn,
} from '@styld/protocol'
import { and, count, desc, eq, inArray, isNotNull, like, notExists, or, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Context, Effect, Option, Schema } from 'effect'
import type { PublicPages } from './Public.ts'

// Explore and search over people and public boards. Rows are found here; what may show is the public pages' rule
// for discovery: passed checks only, and no profile three people reported.

const unavailable = () => Unavailable.make({})
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })

/** How many boards and people each part of Explore and a search shows. */
const rowLimit = 24
const peopleLimit = 12

/** A board row's moods, as the protocol names them. */
const moodsOf = (moods: ReadonlyArray<string>) =>
  moods.flatMap((mood) => Option.toArray(Schema.decodeUnknownOption(Mood)(mood)))

/** A typed word as a `search_text` match: the start of a stored word, with or without its ending. */
const wordLike = (column: typeof boards.searchText | typeof profiles.searchText, word: string) =>
  like(column, `% ${stem(word).replaceAll(/[%_]/gu, '')}%`)

/** The mood a typed word names, in English or Slovenian, as Explore's chips label them. */
const moodWords: Readonly<Record<string, Mood>> = {
  knitwear: 'knitwear',
  pletenine: 'knitwear',
  rain: 'rain',
  dez: 'rain',
  office: 'office',
  pisarna: 'office',
  weekend: 'weekend',
  vikend: 'weekend',
  evening: 'evening',
  vecer: 'evening',
  sport: 'sport',
}

/** A board that has this mood among its own. */
const withMood = (mood: Mood) => sql`exists (select 1 from json_each(${boards.moods}) where value = ${mood})`

const makeQueries = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  const publicBoards = (where: SQL | undefined, order: SQL | typeof boards.publishedAt) =>
    attempt(() =>
      db
        .select()
        .from(boards)
        .where(and(eq(boards.visibility, 'public'), where))
        .orderBy(order)
        .limit(rowLimit),
    )
  return {
    /** Edits from Styld: the house accounts' public boards. */
    houseBoards: () =>
      Effect.flatMap(
        attempt(() => db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.house, true))),
        (house) =>
          house.length === 0
            ? Effect.succeed([])
            : publicBoards(
                inArray(
                  boards.accountId,
                  house.map(({ accountId }) => accountId),
                ),
                desc(boards.publishedAt),
              ),
      ),
    featuredBoards: () => publicBoards(isNotNull(boards.featuredAt), desc(boards.featuredAt)),
    newestBoards: (mood: Option.Option<Mood>) =>
      publicBoards(Option.isSome(mood) ? withMood(mood.value) : undefined, desc(boards.publishedAt)),
    boardsMatching: (words: ReadonlyArray<string>, moods: ReadonlyArray<Mood>) =>
      publicBoards(
        or(and(...words.map((word) => wordLike(boards.searchText, word))), ...moods.map(withMood)),
        desc(boards.publishedAt),
      ),
    /** People to follow: featured first, then the most recently published, leaving out whoever the reader already
     * follows. */
    people: (viewer: Option.Option<string>) =>
      attempt(() =>
        db
          .select({ accountId: profiles.accountId })
          .from(profiles)
          .where(
            and(
              eq(profiles.published, true),
              Option.isSome(viewer)
                ? notExists(
                    db
                      .select({ followeeId: follows.followeeId })
                      .from(follows)
                      .where(and(eq(follows.followerId, viewer.value), eq(follows.followeeId, profiles.accountId))),
                  )
                : undefined,
            ),
          )
          .orderBy(sql`${profiles.featuredAt} is null`, desc(profiles.featuredAt), desc(profiles.publishedAt))
          .limit(peopleLimit * 2),
      ),
    peopleMatching: (words: ReadonlyArray<string>) =>
      attempt(() =>
        db
          .select({ accountId: profiles.accountId, handle: profiles.handle })
          .from(profiles)
          .where(and(eq(profiles.published, true), ...words.map((word) => wordLike(profiles.searchText, word))))
          .orderBy(desc(profiles.publishedAt))
          .limit(peopleLimit * 2),
      ),
    /** Of these accounts, those three or more people reported: they leave discovery. */
    reported: (accountIds: ReadonlyArray<string>) =>
      accountIds.length === 0
        ? Effect.succeed(new Set<string>())
        : Effect.map(
            attempt(() =>
              db
                .select({ accountId: reports.targetId, total: count() })
                .from(reports)
                .where(and(eq(reports.targetKind, 'profile'), inArray(reports.targetId, [...accountIds])))
                .groupBy(reports.targetId),
            ),
            (rows) => new Set(rows.filter(({ total }) => total >= reportsToHide).map(({ accountId }) => accountId)),
          ),
  }
}

const make = (database: Parameters<typeof drizzle>[0], pages: PublicPages['Service']) => {
  const queries = makeQueries(database)
  /** Boards for discovery, without any of a reported profile, each with its moods as the protocol names them. */
  const found = (rows: ReadonlyArray<typeof boards.$inferSelect>, viewer: Option.Option<string>) =>
    Effect.gen(function* () {
      const reported = yield* queries.reported([...new Set(rows.map(({ accountId }) => accountId))])
      const shown = yield* pages.discover(
        rows.filter(({ accountId }) => !reported.has(accountId)),
        viewer,
      )
      return shown.map((entry): FoundBoard => ({ ...entry, moods: moodsOf(entry.moods) }))
    })
  const findable = (accountIds: ReadonlyArray<string>, viewer: Option.Option<string>) =>
    Effect.gen(function* () {
      const reported = yield* queries.reported(accountIds)
      const viewerId = Option.getOrNull(viewer)
      const candidates = accountIds.filter((accountId) => !reported.has(accountId) && accountId !== viewerId)
      const people = yield* Effect.forEach(candidates, (accountId) => pages.findable(accountId, viewer))
      return people.flatMap(Option.toArray).slice(0, peopleLimit)
    })
  /** Someone to follow as Explore shows them: their byline, city and bio. */
  const suggested = ({ author, row }: Effect.Success<ReturnType<typeof findable>>[number]): SuggestedPerson => ({
    ...author,
    city: row.city,
    bio: row.bio,
  })
  return {
    /** Explore: Edits from Styld, featured boards, people to follow and the newest boards, in a mood if chosen. */
    explore: Effect.fn('Styld.Discovery.explore')(function* (mood: Option.Option<Mood>, viewer: Option.Option<string>) {
      const explore: Explore = {
        edits: yield* found(yield* queries.houseBoards(), viewer),
        featured: yield* found(yield* queries.featuredBoards(), viewer),
        people: (yield* findable(
          (yield* queries.people(viewer)).map(({ accountId }) => accountId),
          viewer,
        )).map(suggested),
        newest: yield* found(yield* queries.newestBoards(mood), viewer),
      }
      return explore
    }),
    /** People by name and handle, an exact handle first, and boards by name or mood. */
    search: Effect.fn('Styld.Discovery.search')(function* (query: string, viewer: Option.Option<string>) {
      const words = wordsIn(query).slice(0, 6)
      if (words.length === 0) return { people: [], boards: [] } satisfies SearchResults
      const moods = words.flatMap((word) => Option.toArray(Option.fromNullishOr(moodWords[word])))
      const matching = yield* queries.peopleMatching(words)
      const exact = matching.filter(({ handle }) => handle === words.join('.')).map(({ accountId }) => accountId)
      const people: ReadonlyArray<Author> = (yield* findable(
        [...exact, ...matching.map(({ accountId }) => accountId).filter((id) => !exact.includes(id))],
        viewer,
      )).map(({ author }) => author)
      return {
        people,
        boards: yield* found(yield* queries.boardsMatching(words, moods), viewer),
      } satisfies SearchResults
    }),
  }
}

/** Explore and search. */
export class Discovery extends Context.Service<Discovery, ReturnType<typeof make>>()('@styld/server/Discovery') {}

/** Discovery over the Worker's database and public pages. Build it once per isolate. */
export const makeDiscovery = (database: Parameters<typeof drizzle>[0], pages: PublicPages['Service']) =>
  Discovery.of(make(database, pages))
