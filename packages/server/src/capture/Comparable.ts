import { Effect, Option } from 'effect'
import type { Picture } from './Providers.ts'
import { unavailable } from './Shared.ts'

// Matching compares a sighting with up to ten sightings of its import and six wardrobe pieces, and the next sighting
// with mostly the same ones. Making a stored cut-out into the picture the model compares (decode, shrink, flatten,
// encode) costs up to a second of CPU at the working size, so redoing it for every comparison ran a photo import past
// the Worker's CPU limit and held up every request in the isolate meanwhile (4 November, about 80 photos).
//
// The isolate keeps the pictures it made, each with the stored object's etag, and asks R2 for the object only if the
// etag changed: a cut-out drawn again under the same key is made again. Only finished pictures are kept, never a read
// in progress, so no request waits on I/O another one started (workerd cancels that as hung, 31 October).

/** What the cache reads of a bucket: R2's conditional get, which answers an object without its bytes while the etag
 * still matches. */
export interface ComparableBucket {
  readonly get: (
    key: string,
    options?: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ) => Promise<{ readonly etag: string; readonly arrayBuffer?: () => Promise<ArrayBuffer> } | null>
}

interface Kept {
  readonly etag: string
  readonly picture: Picture
}

/** Comparable pictures of stored objects, at most `capacity` of them, the least recently used going first; `make`
 * turns stored bytes into the picture, or none for bytes that are not one.
 * @internal Exported for its tests. */
export const comparablePictures = (capacity: number, make: (bytes: Uint8Array) => Option.Option<Picture>) => {
  const kept = new Map<string, Kept>()
  const keep = (key: string, entry: Kept) => {
    kept.delete(key)
    kept.set(key, entry)
    for (const oldest of kept.keys()) {
      if (kept.size <= capacity) break
      kept.delete(oldest)
    }
  }
  /** The picture of the object at `key`, none when it is gone or is not a picture. */
  return (bucket: ComparableBucket, key: string) =>
    Effect.gen(function* () {
      const known = kept.get(key)
      const object = yield* Effect.tryPromise({
        try: () => bucket.get(key, known === undefined ? undefined : { onlyIf: { etagDoesNotMatch: known.etag } }),
        catch: unavailable,
      })
      if (object === null) {
        kept.delete(key)
        return Option.none<Picture>()
      }
      // A failed precondition answers without the bytes: the object is the one the kept picture was made from.
      const read = object.arrayBuffer
      if (read === undefined) {
        if (known === undefined) return Option.none<Picture>()
        keep(key, known)
        return Option.some(known.picture)
      }
      const bytes = new Uint8Array(yield* Effect.tryPromise({ try: () => read.call(object), catch: unavailable }))
      const picture = make(bytes)
      if (Option.isSome(picture)) keep(key, { etag: object.etag, picture: picture.value })
      else kept.delete(key)
      return picture
    })
}
