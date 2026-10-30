import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { encodePng } from '@styld/imaging'
import { Effect, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

// Test-only: a piece given a cut-out, as review leaves one when the capture providers are on. Natively they are off,
// so every piece shows its photo, which never goes public.

/** A small grey square on transparency. */
const square = () => {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let at = 0; at < data.length; at += 4) data.set([120, 120, 120, 255], at)
  return encodePng({ width: size, height: size, data })
}

const Target = Schema.Struct({ pieceId: Schema.String.check(Schema.isPattern(/^pc_[A-Za-z0-9_-]{22}$/)) })

/** `POST /test/social/cutout/:pieceId`: the piece's cut-out, stored beside its photo. */
export const socialRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  HttpRouter.add(
    'POST',
    '/test/social/cutout/:pieceId',
    Effect.gen(function* () {
      const { pieceId } = yield* HttpRouter.schemaPathParams(Target)
      const key = `accounts/native-social/captures/seed/${pieceId}-cutout.png`
      yield* media.put(key, square())
      yield* database
        .prepare("UPDATE pieces SET image_key = ?, content_type = 'image/png' WHERE id = ?")
        .bind(key, pieceId)
        .run()
      return HttpServerResponse.empty({ status: 204 })
    }).pipe(Effect.orDie),
  )
