import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Clock, Effect } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as IdentityFixture from './IdentityFixture.ts'
import { colours, cutout } from './PictureFixture.ts'

export const navigationAccount = 'native-eva-navigation'
const id = (kind: 'ph' | 'pc' | 'bd' | 'up' | 'pg', name: string) => `${kind}_${`evanav${name}`.padEnd(22, 'x')}`
export const navigationPhoto = id('ph', 'photo')
export const navigationPiece = id('pc', '20')
export const navigationBoard = id('bd', 'board')

const seed = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    yield* IdentityFixture.seedIdentity(database, navigationAccount)
    const at = yield* Clock.currentTimeMillis
    const key = `accounts/${navigationAccount}/navigation.png`
    const bytes = cutout(colours.blue)
    yield* media.put(key, bytes, { httpMetadata: { contentType: 'image/png' } })
    for (let start = 0; start < 60; start += 10) {
      yield* database.batch(
        Array.from({ length: 10 }, (_, offset) => {
          const i = start + offset
          return database
            .prepare(
              "INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key, content_type, created_at, updated_at) VALUES (?, ?, ?, ?, '[\"blue\"]', '[]', 'ready', 'website', ?, ?, 'image/png', ?, ?)",
            )
            .bind(
              id('pc', String(i)),
              navigationAccount,
              `Navigation ${i < 40 ? 'flats' : 'dress'} ${i}`,
              i < 40 ? 'flats' : 'dresses',
              key,
              key,
              at + i,
              at + i,
            )
        }),
      )
    }
    yield* database.batch([
      database
        .prepare(
          "INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at) VALUES (?, ?, 'Navigation board', 'paper', 0, 'private', '[]', 'navigation board', ?, ?)",
        )
        .bind(navigationBoard, navigationAccount, at, at),
      database
        .prepare(
          "INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at) VALUES (?, ?, 'seeded', 'image/png', ?, ?, 'used', ?)",
        )
        .bind(id('up', 'photo'), navigationAccount, bytes.byteLength, key, at),
      database
        .prepare(
          "INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, favourite, created_at, updated_at) VALUES (?, ?, ?, ?, 'image/png', 'ready', 0, ?, ?)",
        )
        .bind(navigationPhoto, navigationAccount, id('up', 'photo'), key, at, at),
      database
        .prepare(
          "INSERT INTO photo_garments (id, photo_id, account_id, position, cutout_key, type, colours, state) VALUES (?, ?, ?, 0, ?, 'flats', '[\"blue\"]', 'offered')",
        )
        .bind(id('pg', 'garment'), navigationPhoto, navigationAccount, key),
    ])
  })

export const navigationRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  HttpRouter.add(
    'POST',
    '/test/identity/navigation',
    seed(database, media).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
  )
