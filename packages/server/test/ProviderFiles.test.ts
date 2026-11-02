import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { forgetFilesOf, providerFileSweep } from '../src/capture/ProviderFiles.ts'
import { GarmentSegmenter } from '../src/capture/Providers.ts'
import { Database } from '../src/kernel/Db.ts'
import { busy } from '../src/providers/Errors.ts'
import { localD1 } from './LocalD1.ts'

// A video at Meta is the person's footage at a provider: its record stays until Meta confirms the delete, so a delete
// that fails is tried again by the sweep, and an account's files go when the account does.

const minute = 60_000
const now = Date.now()

/** Files recorded at Meta: two an hour old (one Meta will not delete now), one just handed over, one of Bob's. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO provider_files (file_id, provider, account_id, created_at) VALUES
      ('file_old', 'meta-sam', 'ac_1', ${now - 60 * minute}),
      ('file_stuck', 'meta-sam', 'ac_1', ${now - 60 * minute}),
      ('file_new', 'meta-sam', 'ac_1', ${now - minute}),
      ('file_bob', 'meta-sam', 'ac_2', ${now - minute})
  `)
  return database
}

/** Meta deleting every file but `file_stuck`, keeping the deletes it was asked for. */
const meta = (asked: Array<string>) =>
  Layer.succeed(
    GarmentSegmenter,
    // SAFETY: the sweep and account deletion call only `forget`
    GarmentSegmenter.of({
      forget: (fileId: string) =>
        Effect.suspend(() => {
          asked.push(fileId)
          return fileId === 'file_stuck' ? Effect.fail(busy('meta-sam')) : Effect.void
        }),
    } as never),
  )

const recorded = (database: ReturnType<typeof localD1>) =>
  database.sqlite
    .prepare('SELECT file_id FROM provider_files ORDER BY file_id')
    .all()
    .map((row) => row['file_id'])

describe('files at Meta', () => {
  it.live('the sweep deletes what tracking left, and keeps the record of a delete Meta did not confirm', () => {
    const database = seeded()
    const asked: Array<string> = []
    return Effect.gen(function* () {
      expect(yield* providerFileSweep.run).toBe(2)
      expect(asked.toSorted()).toEqual(['file_old', 'file_stuck'])
      expect(recorded(database)).toEqual(['file_bob', 'file_new', 'file_stuck'])
    }).pipe(Effect.provide(Layer.merge(Database.layer(database), meta(asked))))
  })

  it.effect("an account's deletion deletes its files at once, and leaves the others'", () => {
    const database = seeded()
    const asked: Array<string> = []
    return Effect.gen(function* () {
      yield* forgetFilesOf('ac_1')
      expect(asked.toSorted()).toEqual(['file_new', 'file_old', 'file_stuck'])
      expect(recorded(database)).toEqual(['file_bob', 'file_stuck'])
    }).pipe(Effect.provide(Layer.merge(Database.layer(database), meta(asked))))
  })
})
