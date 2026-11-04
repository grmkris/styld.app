import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Clock, Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { seedIdentity } from './IdentityFixture.ts'
import { colours, cutout } from './PictureFixture.ts'

// Test-only: two imports' sightings as the capture pipeline leaves them, compared by the real match job on the
// queue. Natively the capture providers are off, so no capture reaches the match step on its own; the cut-outs are
// one-colour ovals the Clef stand-in matches by colour.

export const scanAccount = 'native-scan'
const prefix = `accounts/${scanAccount}`

const id = (kind: 'cp' | 'dt' | 'pc' | 'up', name: string) => `${kind}_${`nativescan${name}`.padEnd(22, '0')}`

/** The seeded wardrobe piece, the imports' captures and their detections, by name. */
export const scanned = {
  greenPiece: id('pc', 'green'),
  // The first import: a red top in both parts (fuller in the second), a fragment, and the wardrobe's green top again.
  partOne: id('cp', 'a'),
  partTwo: id('cp', 'b'),
  redOne: id('dt', 'a1'),
  fragment: id('dt', 'a2'),
  redTwo: id('dt', 'b1'),
  greenAgain: id('dt', 'b2'),
  // The second import: another red top in both its parts, to split apart.
  partThree: id('cp', 'c'),
  partFour: id('cp', 'd'),
  redThree: id('dt', 'c1'),
  redFour: id('dt', 'd1'),
} as const

const sightings = [
  { capture: 'partOne', importOf: 'partOne', detection: 'redOne', colour: 'red', whole: 0.8, waiting: true },
  { capture: 'partOne', importOf: 'partOne', detection: 'fragment', colour: 'blue', whole: 0.3, waiting: false },
  { capture: 'partTwo', importOf: 'partOne', detection: 'redTwo', colour: 'red', whole: 0.95, waiting: true },
  { capture: 'partTwo', importOf: 'partOne', detection: 'greenAgain', colour: 'green', whole: 0.9, waiting: true },
  { capture: 'partThree', importOf: 'partThree', detection: 'redThree', colour: 'red', whole: 0.7, waiting: true },
  { capture: 'partFour', importOf: 'partThree', detection: 'redFour', colour: 'red', whole: 0.9, waiting: true },
] as const

const captureNames = ['partOne', 'partTwo', 'partThree', 'partFour'] as const

/** The account, its green top, and both imports waiting in the tray, each detection's cut-out stored; then the
 * match job asked for every capture at once, as four parts finishing together would. */
const seed = (
  database: QueryDatabaseClient,
  media: ReadWriteBucketClient,
  queue: { send(message: { readonly _tag: 'MatchCapture'; readonly captureId: string }): Promise<unknown> },
) =>
  Effect.gen(function* () {
    yield* seedIdentity(database, scanAccount)
    const now = yield* Clock.currentTimeMillis
    const greenKey = `${prefix}/pieces/${scanned.greenPiece}/image.png`
    yield* media.put(greenKey, cutout(colours.green))
    const rows = [
      database
        .prepare(
          "INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key, content_type, created_at, updated_at) VALUES (?, ?, 'shortSleeveTops', '[\"green\"]', '[]', 'ready', 'website', ?, ?, 'image/png', ?, ?)",
        )
        .bind(scanned.greenPiece, scanAccount, `${prefix}/uploads/green`, greenKey, now, now),
      // Each part's video upload, then the part.
      ...captureNames.map((name) =>
        database
          .prepare(
            "INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at) VALUES (?, ?, 'seeded', 'video/mp4', 1, ?, 'used', ?)",
          )
          .bind(id('up', name), scanAccount, `${prefix}/uploads/${name}`, now),
      ),
      ...captureNames.map((name, at) =>
        database
          .prepare(
            "INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes, credits, attempt, import_id, created_at, updated_at) VALUES (?, ?, 'video', 'video', 'review', ?, ?, 'video/mp4', 1, 5, 0, ?, ?, ?)",
          )
          .bind(
            scanned[name],
            scanAccount,
            id('up', name),
            `${prefix}/captures/${scanned[name]}/video.mp4`,
            scanned[name === 'partTwo' ? 'partOne' : name === 'partFour' ? 'partThree' : name],
            now - 10_000 + at * 1000,
            now,
          ),
      ),
    ]
    for (const [at, sighting] of sightings.entries()) {
      const key = `${prefix}/captures/${scanned[sighting.capture]}/${scanned[sighting.detection]}.png`
      yield* media.put(key, cutout(colours[sighting.colour]))
      // The still the sighting was cut from: an upload of the video's, as the browser sends its stills.
      const still = `${prefix}/uploads/still-${scanned[sighting.detection]}`
      rows.push(
        database
          .prepare(
            "INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at) VALUES (?, ?, 'seeded', 'image/jpeg', 1, ?, 'used', ?)",
          )
          .bind(id('up', `still-${at}`), scanAccount, still, now),
      )
      rows.push(
        database
          .prepare(
            "INSERT INTO detections (id, capture_id, account_id, status, cutout_key, source_key, preselected, suggested_type, suggested_colours, suggested_occasions, whole, matching, created_at) VALUES (?, ?, ?, 'review', ?, ?, ?, 'shortSleeveTops', ?, '[]', ?, ?, ?)",
          )
          .bind(
            scanned[sighting.detection],
            scanned[sighting.capture],
            scanAccount,
            key,
            still,
            sighting.whole >= 0.5 ? 1 : 0,
            JSON.stringify([sighting.colour]),
            sighting.whole,
            sighting.waiting ? 'waiting' : null,
            now - 10_000 + at * 1000,
          ),
      )
    }
    yield* database.batch(rows)
    yield* Effect.forEach(
      captureNames,
      (name) => Effect.tryPromise(() => queue.send({ _tag: 'MatchCapture', captureId: scanned[name] })),
      {
        concurrency: 'unbounded',
        discard: true,
      },
    )
  })

export const scanRoutes = (
  database: QueryDatabaseClient,
  media: ReadWriteBucketClient,
  queue: { send(message: { readonly _tag: 'MatchCapture'; readonly captureId: string }): Promise<unknown> },
) =>
  Layer.mergeAll(
    HttpRouter.add(
      'POST',
      '/test/scan/seed',
      seed(database, media, queue).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
    ),
  )
