import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import type { Listing } from '../src/kernel/Media.ts'
import { clearOwed, sweepOwed } from '../src/kernel/MediaDeletions.ts'
import { makePhotoStore } from '../src/photos/Store.ts'
import { makeStore, owedPieceOf } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

// A deleted piece's or photo's own objects go durably: the delete's batch records its prefix as owed, the request
// empties it and forgets the record, and a prefix R2 could not list or delete just then stays owed until the sweep
// empties it. On SQLite with every migration and an in-memory bucket that can be made to fail.

const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type,
        created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'ac_1/pc_1.jpg', 'image/jpeg', 0, 0);
  `)
  return database
}

const owedPrefixes = (database: ReturnType<typeof seeded>) =>
  database.sqlite
    .prepare('select prefix from media_deletions order by prefix')
    .all()
    .map((row) => Object.values(row ?? {})[0])

/** A bucket of keys that can be told to fail every call, as R2 does when it cannot be reached. */
const bucketOf = (keys: ReadonlyArray<string>) => {
  const stored = new Set(keys)
  const state = { down: false }
  const bucket: Listing = {
    list: async ({ prefix }) => {
      if (state.down) throw new Error('R2 is down')
      return { objects: [...stored].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }
    },
    delete: async (gone) => {
      if (state.down) throw new Error('R2 is down')
      for (const key of gone) stored.delete(key)
    },
  }
  return { bucket, stored, state }
}

/** When the deletes happened: long before the sweep looks. */
const epoch = new Date(0)

const receiptAt = (at: Date) => ({
  accountId: 'ac_1',
  operationId: `op-${at.getTime()}`,
  command: 'deletePiece',
  inputDigest: 'digest',
  result: 'done',
  createdAt: at,
})

describe("a deleted row's own objects", () => {
  const ownKey = 'accounts/ac_1/pieces/pc_1/cutout.png'

  it.effect('are owed in the delete batch and forgotten once the request empties the prefix', () =>
    Effect.gen(function* () {
      const database = seeded()
      const store = makeStore(drizzle(database))
      const rows = yield* store.listPieces('ac_1')
      yield* store.deletePieces('ac_1', rows, receiptAt(epoch))
      expect(owedPrefixes(database)).toEqual(['accounts/ac_1/pieces/pc_1/'])
      const { bucket, stored } = bucketOf([ownKey, 'accounts/ac_1/pieces/pc_2/cutout.png'])
      expect(yield* clearOwed(store.owedMedia, bucket, [owedPieceOf('ac_1', 'pc_1')])).toBe(1)
      expect([...stored]).toEqual(['accounts/ac_1/pieces/pc_2/cutout.png'])
      expect(owedPrefixes(database)).toEqual([])
    }),
  )

  it.effect('stay owed when R2 cannot list them, and the sweep empties them later', () =>
    Effect.gen(function* () {
      const database = seeded()
      const store = makeStore(drizzle(database))
      const rows = yield* store.listPieces('ac_1')
      yield* store.deletePieces('ac_1', rows, receiptAt(epoch))
      const { bucket, stored, state } = bucketOf([ownKey])
      state.down = true
      expect(yield* clearOwed(store.owedMedia, bucket, [owedPieceOf('ac_1', 'pc_1')])).toBe(0)
      expect(owedPrefixes(database)).toEqual(['accounts/ac_1/pieces/pc_1/'])
      state.down = false
      yield* TestClock.setTime(Date.UTC(2026, 10, 5))
      expect(yield* sweepOwed(store.owedMedia, bucket)).toBe(1)
      expect([...stored]).toEqual([])
      expect(owedPrefixes(database)).toEqual([])
    }),
  )

  it.effect("of a photo are owed in the photo's delete batch", () =>
    Effect.gen(function* () {
      const database = seeded()
      yield* makePhotoStore(drizzle(database)).deletePhoto('ac_1', 'ph_1', receiptAt(epoch))
      expect(owedPrefixes(database)).toEqual(['accounts/ac_1/photos/ph_1/'])
    }),
  )
})
