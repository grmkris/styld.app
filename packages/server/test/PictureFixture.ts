import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { decodePng, encodePng } from '@styld/imaging'
import { Clock, Effect, Layer, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { seedIdentity } from './IdentityFixture.ts'

// Test-only stand-ins for the decision model and the image model behind clean pictures, and their journey's account. They
// answer by what a picture shows, not from recordings: the recorded answers are unit-tested against the adapters
// (CleanPicture.test.ts); natively, the job, D1, R2, the queue and the Wallet are what is proved.

export const picturesAccount = 'native-pictures'

export const colours = { red: [196, 32, 40], green: [40, 150, 60], blue: [40, 60, 190] } as const

/** A garment-shaped cut-out in one colour: an oval on transparency, 300 by 400. */
export const cutout = (colour: readonly [number, number, number]) => {
  const width = 300
  const height = 400
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = ((x - 150) / 120) ** 2 + ((y - 200) / 170) ** 2 <= 1
      data.set(inside ? [...colour, 255] : [0, 0, 0, 0], (y * width + x) * 4)
    }
  return encodePng({ width, height, data })
}

/** The account the clean-picture journey keeps its pieces in. */
const seed = (database: QueryDatabaseClient) => seedIdentity(database, picturesAccount)

/** The backfill journey's account: pieces kept before clean pictures were drawn, as the operator finds them. */
export const backfillAccount = 'native-backfill'

const backfillId = (name: string) => `pc_${`nativebackfill${name}`.padEnd(22, '0')}`

/** The backfill journey's pieces, by name: a red cut-out never drawn, a green one whose drawing waits as proposed
 * (before 4 November), a piece kept as its photo, and a red cut-out still processing. */
export const backfilled = {
  undrawn: backfillId('undrawn'),
  proposed: backfillId('proposed'),
  photo: backfillId('photo'),
  processing: backfillId('processing'),
} as const

/** The backfill journey's account and pieces, their cut-outs stored, and the proposed piece's drawing. */
const seedBackfill = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    yield* seedIdentity(database, backfillAccount)
    const now = yield* Clock.currentTimeMillis
    const prefix = `accounts/${backfillAccount}/pieces`
    const pieces = [
      { id: backfilled.undrawn, colour: 'red', status: 'ready', cutOut: true },
      { id: backfilled.proposed, colour: 'green', status: 'ready', cutOut: true },
      { id: backfilled.photo, colour: 'blue', status: 'ready', cutOut: false },
      { id: backfilled.processing, colour: 'red', status: 'processing', cutOut: true },
    ] as const
    for (const piece of pieces) yield* media.put(`${prefix}/${piece.id}/image.png`, cutout(colours[piece.colour]))
    yield* media.put(`${prefix}/${backfilled.proposed}/clean-1.png`, cutout(colours.green))
    yield* database.batch([
      ...pieces.map((piece, at) => {
        const image = `${prefix}/${piece.id}/image.png`
        return database
          .prepare(
            "INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key, content_type, created_at, updated_at) VALUES (?, ?, 'tops', ?, '[]', ?, 'import', ?, ?, 'image/png', ?, ?)",
          )
          .bind(
            piece.id,
            backfillAccount,
            JSON.stringify([piece.colour]),
            piece.status,
            piece.cutOut ? `${prefix}/${piece.id}/original.png` : image,
            image,
            now - 10_000 + at * 1000,
            now,
          )
      }),
      database
        .prepare(
          "INSERT INTO piece_pictures (piece_id, account_id, state, clean_key, version, redraws, paid, created_at, updated_at) VALUES (?, ?, 'proposed', ?, 1, 0, 0, ?, ?)",
        )
        .bind(backfilled.proposed, backfillAccount, `${prefix}/${backfilled.proposed}/clean-1.png`, now, now),
    ])
  })

/** The colour a flattened picture shows most, ignoring the light grey it was laid on. */
const colourOf = (base64: string) => {
  const picture = decodePng(Result.getOrElse(Base64.decode(base64), () => new Uint8Array()))
  const totals = [0, 0, 0]
  for (let at = 0; at < picture.data.length; at += 4) {
    const [red = 0, green = 0, blue = 0] = picture.data.subarray(at, at + 3)
    if (Math.abs(red - 236) + Math.abs(green - 236) + Math.abs(blue - 236) < 60) continue
    totals[0] = (totals[0] ?? 0) + red
    totals[1] = (totals[1] ?? 0) + green
    totals[2] = (totals[2] ?? 0) + blue
  }
  const strongest = Math.max(...totals)
  return (['red', 'green', 'blue'] as const)[totals.indexOf(strongest)] ?? 'red'
}

const ClefRequest = Schema.Struct({
  images: Schema.Array(Schema.Struct({ base64: Schema.String })),
  questions: Schema.Record(Schema.String, Schema.Unknown),
})

const noul = (value: number) => ({ type: 'noul', noul: value })
const verdict = (choice: 'improve' | 'repair' | 'fragment') => ({
  type: 'choice',
  choice,
  probabilities: { ready: 0.02, improve: 0.02, repair: 0.02, fragment: 0.02, [choice]: 0.94 },
})

/** Clef as the picture job asks it: red is drawn and matches, green is drawn and is offered, blue is a fragment; and as
 * the outfit engine asks it, red goes best. Anything else it is asked answers as Workers AI does on the native stack:
 * unavailable. */
const clef = Effect.gen(function* () {
  const request = yield* HttpServerRequest
  const body = yield* Effect.flatMap(request.json, Schema.decodeUnknownEffect(ClefRequest))
  // An outfit, one picture a piece: the more of them red PNGs, the better it goes, and it always suits. The local
  // Images binding may hand over its own format, which reads as not red.
  if ('goes' in body.questions) {
    const isRed = (base64: string) =>
      Result.getOrElse(
        Result.try(() => colourOf(base64) === 'red'),
        () => false,
      )
    const reds = body.images.filter(({ base64 }) => isRed(base64)).length
    return yield* HttpServerResponse.json({
      model: 'clef-flash',
      answers: { goes: noul(0.3 + (0.6 * reds) / body.images.length), suits: noul(1) },
      usage: { input_tokens: 100 * body.images.length },
    })
  }
  const real = colourOf(body.images.at(-1)?.base64 ?? '')
  if ('picture' in body.questions) {
    const judged = { red: verdict('improve'), green: verdict('repair'), blue: verdict('fragment') }[real]
    return yield* HttpServerResponse.json({ model: 'clef-flash', answers: { picture: judged, face: noul(0.01) } })
  }
  // A turn's frame beside its clean front: the recorded take keeps the garment and its colour; the shirt is plain, so
  // there is no print to keep, and its print is answered low, as Clef answered plain trousers on the preview.
  if ('colour' in body.questions)
    return yield* HttpServerResponse.json({
      model: 'clef-flash',
      answers: { same: noul(0.9), colour: noul(0.9), print: noul(0.06), printed: noul(0.04) },
    })
  // Two sightings, or a sighting and a piece: the same garment when they show the same colour.
  if ('same' in body.questions && !('faithful' in body.questions)) {
    const same = colourOf(body.images[0]?.base64 ?? '') === real ? 0.9 : 0.1
    return yield* HttpServerResponse.json({ model: 'clef-flash', answers: { same: noul(same) } })
  }
  if ('same' in body.questions) {
    const [same, faithful] = real === 'red' ? [0.93, 0.91] : [0.7, 0.75]
    return yield* HttpServerResponse.json({
      model: 'clef-flash',
      answers: { same: noul(same), faithful: noul(faithful) },
    })
  }
  return HttpServerResponse.empty({ status: 503 })
}).pipe(Effect.orDie)

const MuseRequest = Schema.Struct({ prompt: Schema.String })

/** Muse's edit endpoint: the recorded drawing for the key colour asked for, and the prompt kept for the test. */
const muse = (media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    const { prompt } = yield* Effect.flatMap(request.json, Schema.decodeUnknownEffect(MuseRequest))
    yield* media.put(`test/muse-requests/${yield* Clock.currentTimeNanos}`, prompt)
    const answer = yield* media.get(`test/muse-answers/${prompt.includes('magenta') ? 'magenta' : 'green'}.png`)
    if (answer === null) return HttpServerResponse.empty({ status: 500 })
    const b64_json = Base64.encode(new Uint8Array(yield* answer.arrayBuffer()))
    return yield* HttpServerResponse.json({ data: [{ b64_json }] })
  }).pipe(Effect.orDie)

/** The drawings the Muse stand-in answers with, and the turn the gateway stand-in finishes, put by the test from its
 * recorded fixtures. */
const answer = (media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    const key = new URL(request.url, 'http://local.invalid').searchParams.get('key')
    const name = key === 'magenta' ? 'magenta.png' : key === 'video' ? 'turn.mp4' : 'green.png'
    yield* media.put(`test/muse-answers/${name}`, new Uint8Array(yield* request.arrayBuffer))
    return HttpServerResponse.empty({ status: 204 })
  }).pipe(Effect.orDie)

/** The gateway's video protocol: a job started, pending the first time it is asked about, then done with the recorded
 * turn, inline as base64 (the protocol's other form, beside a link to fetch). */
const gateway = (media: ReadWriteBucketClient) => ({
  start: HttpServerResponse.json({ operation: { gatewayJobId: 'job_native' }, warnings: [] }).pipe(Effect.orDie),
  status: Effect.gen(function* () {
    const asked = yield* media.head('test/gateway-asked')
    if (asked === null) {
      yield* media.put('test/gateway-asked', 'once')
      return yield* HttpServerResponse.json({ status: 'pending' })
    }
    const video = yield* media.get('test/muse-answers/turn.mp4')
    if (video === null) return yield* HttpServerResponse.json({ status: 'error', error: 'no recorded turn' })
    const data = Base64.encode(new Uint8Array(yield* video.arrayBuffer()))
    return yield* HttpServerResponse.json({
      status: 'completed',
      videos: [{ type: 'base64', data, mediaType: 'video/mp4' }],
    })
  }).pipe(Effect.orDie),
})

/** The prompts Muse was sent, oldest first. */
const prompts = (media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const listed = yield* media.list({ prefix: 'test/muse-requests/' })
    const keys = listed.objects.map(({ key }) => key).toSorted()
    const texts = yield* Effect.forEach(keys, (key) =>
      Effect.flatMap(media.get(key), (object) => (object === null ? Effect.succeed('') : object.text())),
    )
    return yield* HttpServerResponse.json({ prompts: texts })
  }).pipe(Effect.orDie)

export const pictureRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Layer.mergeAll(
    HttpRouter.add(
      'POST',
      '/test/pictures/seed',
      seed(database).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
    ),
    HttpRouter.add(
      'POST',
      '/test/pictures/backfill/seed',
      seedBackfill(database, media).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
    ),
    HttpRouter.add('POST', '/test/pictures/clef', clef),
    HttpRouter.add('POST', '/test/pictures/meta/v1/images/edits', muse(media)),
    HttpRouter.add('PUT', '/test/pictures/answer', answer(media)),
    HttpRouter.add('GET', '/test/pictures/prompts', prompts(media)),
    HttpRouter.add('POST', '/test/pictures/gateway/video-model/start', gateway(media).start),
    HttpRouter.add('POST', '/test/pictures/gateway/video-model/status', gateway(media).status),
  )
