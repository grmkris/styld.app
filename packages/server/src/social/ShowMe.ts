import { viewerPreferences } from '@styld/db'
import { type Audience, CurrentAccount, type Preferences, type SetShowMe, Unavailable } from '@styld/protocol'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import { Database, first, nowDate, query } from '../kernel/Db.ts'
import { recorded } from '../kernel/Receipts.ts'

// What the person asked to see first (owner, 4 November 2026: Women's, Men's or Everything, asked on Home after they
// sign in). It reorders What's new and Explore's house boards, never hides anything: every board stays reachable by
// paging, search and profiles.

/** Where a board for `audience` ranks for someone who asked to see `choice` first: their choice first (0), then the
 * boards for everyone, those nobody tagged and anything that is not a board (1), then the others (2). With no choice,
 * or Everything, all rank alike. The feed's bands and Explore's order are this rule in SQL (`Feed.ts`, `Discovery.ts`).
 * @internal Exported for its tests. */
export const showMeRank = (choice: Audience | null, audience: Audience | null): 0 | 1 | 2 => {
  if (choice === null || choice === 'all') return 0
  if (audience === choice) return 0
  return audience === null || audience === 'all' ? 1 : 2
}

/** The audience a choice ranks last: the other one. */
export const otherAudience = (choice: 'women' | 'men'): 'women' | 'men' => (choice === 'women' ? 'men' : 'women')

const unavailable = () => Unavailable.make({})

/** The person's preferences as stored; none stored is nothing chosen, never asked. */
export const preferencesOf = (db: Database['Service'], accountId: string) =>
  query(() => db.select().from(viewerPreferences).where(eq(viewerPreferences.accountId, accountId)).limit(1)).pipe(
    Effect.map((rows) =>
      Option.match(first(rows), {
        onNone: (): Preferences => ({ showMe: null, showMeAsked: false }),
        onSome: (row): Preferences => ({ showMe: row.showMe, showMeAsked: row.showMeAskedAt !== null }),
      }),
    ),
    Effect.mapError(unavailable),
  )

const make = Effect.gen(function* () {
  const db = yield* Database
  return {
    getPreferences: Effect.fn('Styld.Preferences.get')(function* () {
      const { accountId } = yield* CurrentAccount
      return yield* preferencesOf(db, accountId)
    }),
    /** Answer Show me, or put Home's card away with no choice; once per operation id, a repeat answering as it is. */
    setShowMe: Effect.fn('Styld.Preferences.setShowMe')(function* (input: SetShowMe) {
      const { accountId } = yield* CurrentAccount
      const at = yield* nowDate
      return yield* recorded(
        db,
        { accountId, operationId: input.operationId, command: 'setShowMe', input: input.showMe },
        {
          write: Effect.succeed({
            statements: [
              db
                .insert(viewerPreferences)
                .values({ accountId, showMe: input.showMe, showMeAskedAt: at })
                .onConflictDoUpdate({
                  target: viewerPreferences.accountId,
                  set: { showMe: input.showMe, showMeAskedAt: at },
                }),
            ],
            result: accountId,
          }),
          answer: () => preferencesOf(db, accountId),
        },
      )
    }),
  }
})

/** The person's reading preferences. */
export class ShowMe extends Context.Service<ShowMe, Effect.Success<typeof make>>()('@styld/server/social/ShowMe') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => ShowMe.of(service)),
  )
}
