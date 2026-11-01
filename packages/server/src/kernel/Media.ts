import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Array, Effect, Schema } from 'effect'

// Stored objects go one way: R2 lists a page at a time and deletes at most a thousand keys a call, so every listing
// pages until it is complete and every delete goes in batches. A row is the truth about an object; the object goes
// after its row, and a failed delete leaves bytes under the account's prefix, which account deletion clears.

/** The media bucket, as Alchemy's runtime object. */
export type Bucket = Effect.Success<Cloudflare.R2.ReadWriteBucketClient['raw']>

/** What listing and deleting need of a bucket: the R2 binding has it, and so can a test's. */
export interface Listing {
  list(options: { readonly prefix: string; readonly limit?: number; readonly cursor?: string }): Promise<{
    readonly objects: ReadonlyArray<{ readonly key: string }>
    readonly truncated: boolean
    readonly cursor?: string
  }>
  delete(keys: Array<string>): Promise<unknown>
}

/** R2 did not answer; the operation may be retried. */
export class MediaUnavailable extends Schema.TaggedError<MediaUnavailable>()('MediaUnavailable', {}) {}

/** R2 deletes at most this many keys a call. */
const deleteBatch = 1000

const call = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => MediaUnavailable.make({}) })

/** Every key under a prefix, page after page. */
export const keysUnder = Effect.fnUntraced(function* (bucket: Listing, prefix: string) {
  const keys: Array<string> = []
  let cursor: string | undefined
  do {
    const page = yield* call(() =>
      bucket.list({ prefix, limit: deleteBatch, ...(cursor === undefined ? {} : { cursor }) }),
    )
    keys.push(...page.objects.map(({ key }) => key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
  return keys
})

/** Delete these keys, a thousand at a time. */
export const deleteKeys = (bucket: Listing, keys: ReadonlyArray<string>) =>
  Effect.forEach(Array.chunksOf(keys, deleteBatch), (chunk) => call(() => bucket.delete([...chunk])), {
    discard: true,
  })

/** Delete everything under a prefix. */
export const deletePrefix = (bucket: Listing, prefix: string) =>
  Effect.flatMap(keysUnder(bucket, prefix), (keys) => deleteKeys(bucket, keys))
