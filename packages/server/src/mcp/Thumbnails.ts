import type { CurrentAccount, ViewImages } from '@styld/protocol'
import { Effect, Option, Record } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import type { MediaGrant } from '../kernel/SignedMedia.ts'
import { collect } from '../Streams.ts'
import { deliverImage, transformedOnly, type ImageBindings } from '../wardrobe/Delivery.ts'

// The pictures an assistant view shows (MCP Apps): thumbnails of objects the read behind the view already authorized,
// as data URLs in the result's `_meta`, out of the model's context, because a host's sandbox cannot load Styld's
// private image routes. Owner decision, 4 November 2026: the person's own pieces, boards, Gallery photos, the photo a
// try-on started from and its result may go to the host this way, and never as an original file.

/** A view shows this many pictures at most, unless it asks for fewer. */
const viewImageLimit = 24

/** A thumbnail is only what the Images binding transformed (`transformedOnly`): an original photo, which may carry its
 * EXIF and GPS, never goes to a host. A transformed one larger than this is left out too. */
const largestThumbnail = 200 * 1024

/** A result's pictures together stay under this, in the order the view shows them: the rest keep their place in the
 * view without a picture. */
const largestResult = 1.5 * 1024 * 1024

type Thumbnail = { readonly body: Parameters<typeof collect>[0]; readonly contentType: string }

/** A thumbnail's bytes, or nothing when it cannot be read or is not a small WebP. */
const thumbnailBytes = (read: Effect.Effect<Thumbnail, unknown, CurrentAccount>) =>
  read.pipe(
    Effect.filterOrFail(
      ({ contentType }) => contentType === 'image/webp',
      () => 'notThumbnail' as const,
    ),
    Effect.flatMap(({ body }) =>
      Effect.tryPromise({ try: () => collect(body), catch: () => 'unreadable' as const }).pipe(
        Effect.filterOrFail(
          (bytes) => bytes.byteLength <= largestThumbnail,
          () => 'notThumbnail' as const,
        ),
      ),
    ),
    Effect.option,
  )

/** Each target's thumbnail under its name, from the grant the read authorized: the first `limit` of them, read a few
 * at a time, kept in order while the result stays under `largestResult`. No thumbnail performs another D1 lookup. */
export const thumbnailsOf = (
  media: ImageBindings,
  targets: ReadonlyArray<readonly [string, MediaGrant]>,
  limit = viewImageLimit,
) =>
  Effect.map(
    Effect.forEach(
      targets.slice(0, limit),
      ([name, grant]) =>
        Effect.map(
          thumbnailBytes(
            deliverImage(media, grant, 'thumb', { ...transformedOnly, rotation: grant.rotation }).pipe(
              Effect.flatMap(Option.match({ onNone: () => Effect.fail('missing' as const), onSome: Effect.succeed })),
            ),
          ),
          (bytes) => Option.map(bytes, (found) => [name, found] as const),
        ),
      { concurrency: 6 },
    ),
    (found): ViewImages => {
      let total = 0
      const kept = found.flatMap(Option.toArray).filter(([, bytes]) => {
        total += bytes.byteLength
        return total <= largestResult
      })
      return Record.fromEntries(kept.map(([name, bytes]) => [name, `data:image/webp;base64,${Base64.encode(bytes)}`]))
    },
  )

/** Each target's thumbnail by the entity whose picture it shows (`withViewThumbnails` › `images`). */
export const thumbnails = (
  media: ImageBindings,
  images: ReadonlyMap<string, MediaGrant>,
  targets: ReadonlyArray<readonly [string, string]>,
  limit = viewImageLimit,
) =>
  thumbnailsOf(
    media,
    targets.flatMap(([name, id]) =>
      Option.toArray(Option.map(Option.fromNullishOr(images.get(id)), (grant) => [name, grant] as const)),
    ),
    limit,
  )
