import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { ImportManifest } from '@styld/protocol'
import { Effect, Layer, Schedule, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

// Test-only: an import bundle put in the media bucket as the operator's importer puts it (`tools/import-v1`), and the
// account an import made, read back from the auth tables registration writes.

const Bundle = Schema.Struct({
  importId: Schema.String,
  manifest: ImportManifest,
  /** Each picture's file in the bundle, and its bytes as base64. */
  pictures: Schema.Record(Schema.String, Schema.String),
})

/** `POST /test/imports/bundle` writes a bundle; `GET /test/imports/account?email=` reads the email's sign-in rows. */
export const importRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Layer.mergeAll(
    HttpRouter.add(
      'POST',
      '/test/imports/bundle',
      Effect.gen(function* () {
        const bundle = yield* Effect.flatMap((yield* HttpServerRequest).json, Schema.decodeUnknownEffect(Bundle))
        const prefix = `imports/${bundle.importId}/`
        yield* media.put(`${prefix}manifest.json`, JSON.stringify(bundle.manifest))
        for (const [file, base64] of Object.entries(bundle.pictures))
          yield* media.put(`${prefix}${file}`, yield* Effect.fromResult(Base64.decode(base64)))
        return HttpServerResponse.empty({ status: 204 })
      }).pipe(Effect.orDie),
    ),
    HttpRouter.add(
      'GET',
      '/test/imports/account',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const email = new URL(request.url, 'http://local.invalid').searchParams.get('email') ?? ''
        const row = yield* database
          .prepare(
            `SELECT a.id AS accountId, a.enabled AS enabled, i.verified_at IS NOT NULL AS verified,
               (SELECT count(*) FROM styld_auth_credentials c WHERE c.subject_id = a.id AND c.active = 1) AS credentials,
               (SELECT count(*) FROM styld_auth_email_credentials e WHERE e.subject_id = a.id AND e.active = 1
                  AND e.identifier_value = i.value) AS emailCredentials,
               (SELECT count(*) FROM styld_auth_passwords p WHERE p.subject_id = a.id) AS passwords
             FROM styld_auth_identifiers i JOIN accounts a ON a.id = i.subject_id
             WHERE i.namespace = 'email' AND i.value = ?`,
          )
          .bind(email)
          .first()
          // Local D1 answers SQLITE_BUSY while the API Worker writes; Alchemy's client makes that a defect.
          .pipe(
            Effect.catchDefect((defect) => Effect.fail(defect)),
            Effect.retry({ times: 60, schedule: Schedule.spaced('200 millis') }),
          )
        return yield* HttpServerResponse.json(row)
      }).pipe(Effect.orDie),
    ),
  )
