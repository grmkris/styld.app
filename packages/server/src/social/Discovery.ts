import { boards, boardTags, follows, profiles, seededBoards } from '@styld/db'
import {
  type Audience,
  type Author,
  ChallengeKey,
  type Challenges,
  type Explore,
  type FoundBoard,
  Mood,
  type SearchResults,
  stem,
  type SuggestedPerson,
  Unavailable,
  wordsIn,
} from '@styld/protocol'
import { and, desc, eq, exists, inArray, isNotNull, like, notExists, or, type SQL, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { Database, query } from '../kernel/Db.ts'
import { shownToOthers } from './ProfileStore.ts'
import { PublicPages } from './Public.ts'
import { otherAudience, preferencesOf } from './ShowMe.ts'
import { SocialStore } from './SocialStore.ts'

// Explore and search over people and public boards. Rows are found here; what may show is the public pages' rule
// for discovery: passed checks only, and no profile three people reported.

const unavailable = () => Unavailable.make({})
/** A D1 read; a store that does not answer is unavailable. */
const read = <A>(run: () => Promise<A>) => query(run).pipe(Effect.mapError(unavailable))

/** How many boards and people each part of Explore and a search shows. */
const rowLimit = 24

/** The house board each of Eva's challenges opens, by its id in the seed catalogue (`tools/seed/catalogue.yaml`). */
const challengeBoards: Readonly<Record<string, ChallengeKey | undefined>> = {
  'u-30-days-red': 'red',
  'w-witch-october': 'witch',
  'u-one-coat-6': 'onePiece',
}
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

/** A board's place for a reader who chose Show me: their choice first, the boards for everyone or nobody in particular
 * next, the others last (`showMeRank`, in SQL). */
const showMeOrder = (db: Database['Service'], choice: 'women' | 'men') => {
  const tagged = (audience: Audience) =>
    exists(
      db
        .select({ id: boardTags.boardId })
        .from(boardTags)
        .where(and(eq(boardTags.boardId, boards.id), eq(boardTags.kind, 'audience'), eq(boardTags.value, audience))),
    )
  return sql`CASE WHEN ${tagged(choice)} THEN 0 WHEN ${tagged(otherAudience(choice))} THEN 2 ELSE 1 END`
}

const makeQueries = (db: Database['Service']) => {
  const publicBoards = (where: SQL | undefined, ...order: ReadonlyArray<SQL | typeof boards.publishedAt>) =>
    read(() =>
      db
        .select()
        .from(boards)
        .where(and(eq(boards.visibility, 'public'), where))
        .orderBy(...order)
        .limit(rowLimit),
    )
  return {
    /** The public house boards Eva's challenges open, with the catalogue id each was seeded from. */
    challengeBoards: () =>
      read(() =>
        db
          .select({ seedId: seededBoards.seedId, board: boards })
          .from(seededBoards)
          .innerJoin(boards, eq(boards.id, seededBoards.boardId))
          .where(and(inArray(seededBoards.seedId, Object.keys(challengeBoards)), eq(boards.visibility, 'public'))),
      ),
    /** Edits from Styld: the house accounts' public boards, newest first (they go public interleaved by audience), or
     * for a reader who chose Show me, the boards for their choice first (owner, 4 November 2026), before the limit. */
    houseBoards: (choice: Audience | null) =>
      Effect.flatMap(
        read(() => db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.house, true))),
        (house) =>
          house.length === 0
            ? Effect.succeed([])
            : publicBoards(
                inArray(
                  boards.accountId,
                  house.map(({ accountId }) => accountId),
                ),
                ...(choice === null || choice === 'all' ? [] : [showMeOrder(db, choice)]),
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
      read(() =>
        db
          .select({ accountId: profiles.accountId })
          .from(profiles)
          .where(
            and(
              shownToOthers(db),
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
      read(() =>
        db
          .select({ accountId: profiles.accountId, handle: profiles.handle })
          .from(profiles)
          .where(and(shownToOthers(db), ...words.map((word) => wordLike(profiles.searchText, word))))
          .orderBy(desc(profiles.publishedAt))
          .limit(peopleLimit * 2),
      ),
  }
}

const make = Effect.gen(function* () {
  const db = yield* Database
  const queries = makeQueries(db)
  const pages = yield* PublicPages
  const social = yield* SocialStore
  const reported = (accountIds: ReadonlyArray<string>) =>
    social.reportedProfiles(accountIds).pipe(Effect.mapError(unavailable))
  /** Boards for discovery, without any of a reported profile, each with its moods as the protocol names them. */
  const found = (rows: ReadonlyArray<typeof boards.$inferSelect>, viewer: Option.Option<string>) =>
    Effect.gen(function* () {
      const hidden = yield* reported([...new Set(rows.map(({ accountId }) => accountId))])
      const shown = yield* pages.discover(
        rows.filter(({ accountId }) => !hidden.has(accountId)),
        viewer,
      )
      return shown.map((entry): FoundBoard => ({ ...entry, moods: moodsOf(entry.moods) }))
    })
  const findable = (accountIds: ReadonlyArray<string>, viewer: Option.Option<string>) =>
    Effect.gen(function* () {
      const hidden = yield* reported(accountIds)
      const viewerId = Option.getOrNull(viewer)
      const candidates = accountIds.filter((accountId) => !hidden.has(accountId) && accountId !== viewerId)
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
      const choice = Option.isSome(viewer) ? (yield* preferencesOf(db, viewer.value)).showMe : null
      const explore: Explore = {
        edits: yield* found(yield* queries.houseBoards(choice), viewer),
        featured: yield* found(yield* queries.featuredBoards(), viewer),
        people: (yield* findable(
          (yield* queries.people(viewer)).map(({ accountId }) => accountId),
          viewer,
        )).map(suggested),
        newest: yield* found(yield* queries.newestBoards(mood), viewer),
      }
      return explore
    }),
    /** Eva's three challenges that have a house board discovery may show, in her order (owner, 4 November 2026). */
    challenges: Effect.fn('Styld.Discovery.challenges')(function* (viewer: Option.Option<string>) {
      const seeded = yield* queries.challengeBoards()
      const shown = yield* found(
        seeded.map(({ board }) => board),
        viewer,
      )
      const keyOf = new Map(seeded.map(({ seedId, board }) => [board.id, challengeBoards[seedId]]))
      const challenges = ChallengeKey.literals.flatMap((challenge) =>
        shown
          .filter(({ board }) => keyOf.get(board.id) === challenge)
          .slice(0, 1)
          .map((board) => ({ challenge, found: board })),
      )
      return { challenges } satisfies Challenges
    }),
    /** People by name and handle, an exact handle first, and boards by name or mood. */
    search: Effect.fn('Styld.Discovery.search')(function* (q: string, viewer: Option.Option<string>) {
      const words = wordsIn(q).slice(0, 6)
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
})

/** Explore and search, by the public pages' rule for discovery. */
export class Discovery extends Context.Service<Discovery, Effect.Success<typeof make>>()(
  '@styld/server/social/Discovery',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Discovery.of(service)),
  ).pipe(Layer.provide(SocialStore.layer))
}
