import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Clock, Effect } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { seedIdentity } from './IdentityFixture.ts'
import { colours, cutout } from './PictureFixture.ts'

// Synthetic, local-only load fixture: no personal photos and no paid providers.
export const mediaLoadAccount = 'native-eva-media'
const id = (kind: string, name: string) => `${kind}_${`evaload${name}`.padEnd(22, 'x')}`
export const mediaLoadBoard = id('bd', 'board')

const seed = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    yield* seedIdentity(database, mediaLoadAccount)
    const at = yield* Clock.currentTimeMillis
    const key = `accounts/${mediaLoadAccount}/load/garment.png`
    const bytes = cutout(colours.blue)
    yield* media.put(key, bytes, { httpMetadata: { contentType: 'image/png' } })
    const upload = (name: string) =>
      database
        .prepare(
          "INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at) VALUES (?, ?, 'seeded', 'image/png', ?, ?, 'used', ?)",
        )
        .bind(id('up', name), mediaLoadAccount, bytes.byteLength, key, at)
    yield* database.batch([
      database
        .prepare(
          "INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at) VALUES (?, ?, 'Media load board', 'paper', 0, 'private', '[]', 'media load board', ?, ?)",
        )
        .bind(mediaLoadBoard, mediaLoadAccount, at, at),
      ...Array.from({ length: 50 }, (_, i) =>
        database
          .prepare(
            "INSERT INTO board_images (id, account_id, board_id, object_key, content_type, origin, created_at) VALUES (?, ?, ?, ?, 'image/png', 'upload', ?)",
          )
          .bind(id('bm', String(i)), mediaLoadAccount, mediaLoadBoard, key, at + i),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        database
          .prepare("INSERT INTO board_pins (id, board_id, kind, image_id, created_at) VALUES (?, ?, 'picture', ?, ?)")
          .bind(id('pn', String(i)), mediaLoadBoard, id('bm', String(i)), at + i),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        database
          .prepare(
            "INSERT INTO board_items (board_id, id, kind, image_id, x, y, size, turn, z, flipped) VALUES (?, ?, 'image', ?, ?, ?, 140, 0, ?, 0)",
          )
          .bind(
            mediaLoadBoard,
            id('bi', String(i)),
            id('bm', String(i)),
            100 + (i % 5) * 200,
            65 + Math.floor(i / 5) * 125,
            i,
          ),
      ),
    ])
    // Keep each batch below the local D1 binding's parameter/statement limits.
    for (let start = 0; start < 100; start += 20) {
      yield* database.batch(
        Array.from({ length: 20 }, (_, offset) => {
          const i = start + offset
          return [
            upload(`photo${i}`),
            database
              .prepare(
                "INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, favourite, created_at, updated_at) VALUES (?, ?, ?, ?, 'image/png', 'ready', 0, ?, ?)",
              )
              .bind(id('ph', String(i)), mediaLoadAccount, id('up', `photo${i}`), key, at + i, at + i),
          ]
        }).flat(),
      )
    }
    yield* database.batch([
      upload('capture'),
      database
        .prepare(
          "INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes, credits, attempt, created_at, updated_at) VALUES (?, ?, 'photo', 'picker', 'review', ?, ?, 'image/png', ?, 1, 0, ?, ?)",
        )
        .bind(id('cp', 'capture'), mediaLoadAccount, id('up', 'capture'), key, bytes.byteLength, at, at),
      ...Array.from({ length: 30 }, (_, i) =>
        database
          .prepare(
            "INSERT INTO detections (id, capture_id, account_id, status, cutout_key, source_key, preselected, suggested_type, suggested_colours, suggested_occasions, whole, created_at) VALUES (?, ?, ?, 'review', ?, ?, 1, 'tops', '[\"blue\"]', '[]', 0.9, ?)",
          )
          .bind(id('dt', String(i)), id('cp', 'capture'), mediaLoadAccount, key, key, at + i),
      ),
    ])
  })

export const mediaLoadRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  HttpRouter.add(
    'POST',
    '/test/identity/media-load',
    seed(database, media).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
  )
