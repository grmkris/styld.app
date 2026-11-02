import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { deletePrefix, keysUnder, type Listing, Media } from '../src/kernel/Media.ts'
import { deliverImage, transformedOnly } from '../src/wardrobe/Delivery.ts'

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

/** A bucket holding one original photo, and an Images binding that cannot transform it. */
const untransformableFake = {
  bucket: {
    get: async () => ({ body: new Blob(['original with EXIF']).stream(), httpMetadata: { contentType: 'image/jpeg' } }),
  },
  images: {
    input: () => ({
      transform: () => ({ output: () => Promise.reject(new Error('Images could not read it')) }),
    }),
  },
}
// SAFETY: delivery reads only `get` of the bucket and `input` of the Images binding, which the fake implements
const untransformable = Media.of(untransformableFake as never)

describe('delivered images', () => {
  const stored = { key: 'accounts/ac_1/photo.jpg', contentType: 'image/jpeg' }

  it.effect("fall back to the stored photo only for its owner's own browser", () =>
    Effect.gen(function* () {
      const delivered = yield* deliverImage(untransformable, stored, 'thumb')
      expect(Option.map(delivered, ({ contentType }) => contentType)).toEqual(Option.some('image/jpeg'))
    }),
  )

  it.effect('never hand the stored original elsewhere: a failed transform is no image', () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(deliverImage(untransformable, stored, 'thumb', transformedOnly))
      expect(failed).toMatchObject({ _tag: 'Unavailable' })
    }),
  )
})
