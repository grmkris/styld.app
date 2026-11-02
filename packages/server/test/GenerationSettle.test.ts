import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { settleJob } from '../src/generation/Shared.ts'
import { generationStore } from '../src/generation/Store.ts'
import { type Ending, Holds } from '../src/usage/Holds.ts'
import { localD1 } from './LocalD1.ts'

// A generation job that ended has its credit settled by the delivery that ended it; if that settle is lost, the sweep
// settles it again from the job's status (the first settlement stands, so sending it again is safe).

const minute = 60_000
const now = Date.now()
/** The sweep's window: ended over five minutes and within the hour. */
const hourAgo = new Date(now - 60 * minute)
const fiveMinutesAgo = new Date(now - 5 * minute)

const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, created_at, updated_at)
      VALUES ('bd_1', 'ac_1', 'Autumn', 'paper', 0, 'private', 0, 0);
  `)
  const job = (id: string, status: string, updatedAt: number) =>
    database.sqlite.exec(
      `INSERT INTO generation_jobs (id, account_id, board_id, kind, prompt, status, held, collage_version, picks, moods,
         created_at, updated_at)
       VALUES ('${id}', 'ac_1', 'bd_1', 'sticker', 'a fern', '${status}', 1, 0, '[]', '[]', 0, ${updatedAt})`,
    )
  job('gj_failed', 'failed', now - 20 * minute)
  job('gj_refused', 'refused', now - 30 * minute)
  job('gj_done', 'done', now - 40 * minute)
  job('gj_just_failed', 'failed', now - minute)
  job('gj_long_ago', 'failed', now - 3 * 60 * minute)
  job('gj_drawing', 'drawing', now - 20 * minute)
  return database
}

describe('the generation sweep', () => {
  it.effect('settles again every job that ended in the last hour, by its status', () =>
    Effect.gen(function* () {
      const store = generationStore(drizzle(seeded()))
      const settled: Array<readonly [string, Ending]> = []
      const holds: Holds['Service'] = {
        reserve: () => Effect.void,
        remaining: () => Effect.succeed(0),
        settle: (_accountId, hold, ending) => Effect.sync(() => void settled.push([hold, ending])),
      }
      const ended = yield* store.endedJobs(hourAgo, fiveMinutesAgo, 50)
      expect(ended.map(({ id }) => id)).toEqual(['gj_done', 'gj_refused', 'gj_failed'])
      yield* Effect.forEach(ended, settleJob).pipe(Effect.provideService(Holds, holds))
      expect(settled.map(([, ending]) => ending)).toEqual(['succeeded', 'failed', 'failed'])
      expect(settled.every(([hold]) => hold.startsWith('generation'))).toBe(true)
    }),
  )
})
