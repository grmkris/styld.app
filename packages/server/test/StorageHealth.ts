// Test-only storage probe: the schema is not served by the deployed Worker.
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { readSchema } from './SchemaShape.ts'

/** The live D1 schema as `sqlite_master` and SQLite's pragmas read it (`SchemaShape.ts`), and the media binding. */
export const storageHealth = (database: QueryDatabaseClient, media: ReadWriteBucketClient) => {
  const read = (sql: string) => Effect.map(database.prepare(sql).all(), ({ results }) => results)
  return Effect.gen(function* () {
    const schema = yield* readSchema(read)
    const mediaHealth = yield* media.head('health/sentinel').pipe(Effect.orDie)
    return yield* HttpServerResponse.json({ database: schema, media: { sentinel: mediaHealth !== null } })
  })
}
