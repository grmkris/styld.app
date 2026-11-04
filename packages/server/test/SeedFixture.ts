import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Clock, Effect, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { colours, cutout } from './PictureFixture.ts'

// Test-only: house garments as the seed's import leaves them (`tools/seed/`), straight into D1 and R2: each a ready
// piece of the house account with its cut-out stored, its import receipt `seed:<manifest id>` and its provenance as a
// garment the seed generated. The import itself is the import journey's (ImportAcceptance.ts).

const Garments = Schema.Struct({
  accountId: Schema.String,
  garments: Schema.Array(
    Schema.Struct({
      manifestId: Schema.String,
      type: Schema.String,
      colour: Schema.Literals(['red', 'green', 'blue']),
    }),
  ),
})

const pieceIdOf = (manifestId: string) =>
  `pc_${manifestId
    .replaceAll(/[^A-Za-z0-9]/gu, '')
    .padEnd(22, '0')
    .slice(0, 22)}`

/** `POST /test/seed/garments` puts the house garments in place. */
export const seedRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  HttpRouter.add(
    'POST',
    '/test/seed/garments',
    Effect.gen(function* () {
      const { accountId, garments } = yield* Effect.flatMap(
        (yield* HttpServerRequest).json,
        Schema.decodeUnknownEffect(Garments),
      )
      const now = yield* Clock.currentTimeMillis
      for (const garment of garments) {
        const key = `accounts/${accountId}/pieces/${pieceIdOf(garment.manifestId)}/cutout.png`
        yield* media.put(key, cutout(colours[garment.colour]))
      }
      yield* database.batch(
        garments.flatMap((garment) => {
          const pieceId = pieceIdOf(garment.manifestId)
          const prefix = `accounts/${accountId}/pieces/${pieceId}`
          return [
            database
              .prepare(
                "INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key, content_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 'ready', 'import', ?, ?, 'image/png', ?, ?)",
              )
              .bind(
                pieceId,
                accountId,
                garment.manifestId,
                garment.type,
                JSON.stringify([garment.colour]),
                `${prefix}/original.png`,
                `${prefix}/cutout.png`,
                now,
                now,
              ),
            database
              .prepare('INSERT INTO imported_pieces (account_id, v1_id, piece_id) VALUES (?, ?, ?)')
              .bind(accountId, `seed:${garment.manifestId}`, pieceId),
            database
              .prepare(
                "INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, model, prompt_digest, updated_at) VALUES (?, ?, 'generated', ?, 'muse-image-1.0', ?, ?)",
              )
              .bind(pieceId, accountId, garment.manifestId, 'a'.repeat(64), now),
          ]
        }),
      )
      return HttpServerResponse.empty({ status: 204 })
    }).pipe(Effect.orDie),
  )
