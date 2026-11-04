import { Effect, Option } from 'effect'
import { expect, test } from 'vitest'
import { comparablePictures, type ComparableBucket } from '../src/capture/Comparable.ts'

/** A bucket as R2 answers a conditional read: no body when the etag still matches, and what it was asked for. */
const bucketOf = () => {
  const objects = new Map<string, { etag: string; bytes: Uint8Array }>()
  const reads: Array<{ key: string; body: boolean }> = []
  const get = async (key: string, options?: { onlyIf?: { etagDoesNotMatch?: string } }) => {
    const object = objects.get(key)
    if (object === undefined) return null
    const unchanged = options?.onlyIf?.etagDoesNotMatch === object.etag
    reads.push({ key, body: !unchanged })
    return unchanged
      ? { etag: object.etag }
      : { etag: object.etag, arrayBuffer: async () => object.bytes.slice().buffer }
  }
  const bucket: ComparableBucket = { get }
  const put = (key: string, etag: string, byte: number) => objects.set(key, { etag, bytes: Uint8Array.of(byte) })
  return { bucket, put, reads, remove: (key: string) => objects.delete(key) }
}

const counting = (capacity: number) => {
  const made: Array<number> = []
  const picture = comparablePictures(capacity, (bytes) => {
    made.push(bytes[0] ?? -1)
    return bytes[0] === 0 ? Option.none() : Option.some({ bytes, contentType: 'image/png' as const })
  })
  return { picture, made }
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect)
const byteOf = (picture: Option.Option<{ readonly bytes: Uint8Array }>) =>
  Option.match(picture, { onNone: () => null, onSome: ({ bytes }) => bytes[0] })

test('makes a stored picture once, reads it again without its body while it is unchanged, and again once it changed', async () => {
  const { bucket, put, reads } = bucketOf()
  const { picture, made } = counting(4)
  put('a.png', 'e1', 1)
  expect(byteOf(await run(picture(bucket, 'a.png')))).toBe(1)
  expect(byteOf(await run(picture(bucket, 'a.png')))).toBe(1)
  put('a.png', 'e2', 2)
  expect(byteOf(await run(picture(bucket, 'a.png')))).toBe(2)
  expect(made).toEqual([1, 2])
  expect(reads).toEqual([
    { key: 'a.png', body: true },
    { key: 'a.png', body: false },
    { key: 'a.png', body: true },
  ])
})

test('a deleted object is none and forgotten, and bytes that are no picture are not kept', async () => {
  const { bucket, put, remove } = bucketOf()
  const { picture, made } = counting(4)
  put('a.png', 'e1', 1)
  await run(picture(bucket, 'a.png'))
  remove('a.png')
  expect(Option.isNone(await run(picture(bucket, 'a.png')))).toBe(true)
  put('a.png', 'e1', 1)
  await run(picture(bucket, 'a.png'))
  put('b.png', 'e1', 0)
  expect(Option.isNone(await run(picture(bucket, 'b.png')))).toBe(true)
  expect(Option.isNone(await run(picture(bucket, 'b.png')))).toBe(true)
  expect(made).toEqual([1, 1, 0, 0])
})

test('keeps at most its capacity, letting the least recently used go first', async () => {
  const { bucket, put } = bucketOf()
  const { picture, made } = counting(2)
  put('a.png', 'e', 1)
  put('b.png', 'e', 2)
  put('c.png', 'e', 3)
  await run(picture(bucket, 'a.png'))
  await run(picture(bucket, 'b.png'))
  // Reading `a` again makes `b` the oldest, so `c` pushes `b` out.
  await run(picture(bucket, 'a.png'))
  await run(picture(bucket, 'c.png'))
  await run(picture(bucket, 'a.png'))
  await run(picture(bucket, 'b.png'))
  expect(made).toEqual([1, 2, 3, 2])
})
