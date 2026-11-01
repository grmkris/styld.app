import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { deletePrefix, keysUnder, type Listing } from '../src/kernel/Media.ts'

/** A bucket of `count` keys under one prefix that lists `pageSize` at a time, and records each delete. */
const pagedBucket = (count: number, pageSize: number) => {
  const keys = Array.from({ length: count }, (_, index) => `accounts/ac_1/k${String(index).padStart(5, '0')}`)
  const deletes: Array<Array<string>> = []
  const bucket: Listing = {
    list: ({ cursor }) => {
      const from = cursor === undefined ? 0 : Number(cursor)
      const page = keys.slice(from, from + pageSize).map((key) => ({ key }))
      const next = from + pageSize
      return Promise.resolve(
        next < keys.length
          ? { objects: page, truncated: true, cursor: String(next) }
          : { objects: page, truncated: false },
      )
    },
    delete: (batch: Array<string>) => {
      deletes.push(batch)
      return Promise.resolve()
    },
  }
  return { bucket, deletes }
}

describe('stored objects', () => {
  it.effect('lists every page under a prefix, not only the first', () =>
    Effect.gen(function* () {
      const { bucket } = pagedBucket(2500, 1000)
      expect(yield* keysUnder(bucket, 'accounts/ac_1/')).toHaveLength(2500)
    }),
  )

  it.effect('deletes more than a thousand keys in batches R2 accepts', () =>
    Effect.gen(function* () {
      const { bucket, deletes } = pagedBucket(2500, 1000)
      yield* deletePrefix(bucket, 'accounts/ac_1/')
      expect(deletes.map((batch) => batch.length)).toEqual([1000, 1000, 500])
    }),
  )
})
