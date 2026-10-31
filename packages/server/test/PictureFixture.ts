import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { decodePng, encodePng } from '@styld/imaging'
import { Clock, Effect, Layer, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { seedIdentity } from './IdentityFixture.ts'

// Test-only stand-ins for the decision model and the image model behind clean pictures, with seeded cut-outs. They
// answer by what a picture shows, not from recordings: the recorded answers are unit-tested against the adapters
// (CleanPicture.test.ts); natively, the job, D1, R2, the queue and the Wallet are what is proved.

export const picturesAccount = 'native-pictures'
const prefix = `accounts/${picturesAccount}`

/** The seeded pieces: a red tee to draw, kept as clean before every piece was drawn; a green shirt to draw on
 * magenta; a blue scrap too small to draw; and a piece kept as its photo. */
export const seededPieces = {
  red: `pc_${'nativepicturesred'.padEnd(22, '0')}`,
  green: `pc_${'nativepicturesgreen'.padEnd(22, '0')}`,
  blue: `pc_${'nativepicturesblue'.padEnd(22, '0')}`,
  photo: `pc_${'nativepicturesphoto'.padEnd(22, '0')}`,
} as const

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

const pieceRow = (id: string, imageKey: string, originalKey: string, contentType: string, now: number) =>
  [id, picturesAccount, 'tops', '[]', 'ready', 'website', originalKey, imageKey, contentType, 1, now, now] as const

/** The account and its pieces, each cut-out stored where a reviewed piece's would be. */
const seed = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    yield* seedIdentity(database, picturesAccount)
    const now = yield* Clock.currentTimeMillis
    const insert = database.prepare(
      'INSERT INTO pieces (id, account_id, type, colours, status, source, original_key, image_key, content_type, bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const rows = []
    for (const name of ['red', 'green', 'blue'] as const) {
      const id = seededPieces[name]
      yield* media.put(`${prefix}/captures/seed/${name}-cutout.png`, cutout(colours[name]))
      yield* media.put(`${prefix}/captures/seed/${name}.jpg`, 'a photo')
      rows.push(
        insert.bind(
          ...pieceRow(
            id,
            `${prefix}/captures/seed/${name}-cutout.png`,
            `${prefix}/captures/seed/${name}.jpg`,
            'image/jpeg',
            now,
          ),
        ),
      )
    }
    yield* media.put(`${prefix}/uploads/photo`, cutout(colours.red))
    rows.push(
      insert.bind(
        ...pieceRow(seededPieces.photo, `${prefix}/uploads/photo`, `${prefix}/uploads/photo`, 'image/png', now),
      ),
    )
    rows.push(
      database
        .prepare(
          "INSERT INTO piece_pictures (piece_id, account_id, state, version, judge, judge_confidence, face, created_at, updated_at) VALUES (?, ?, 'kept-real', 0, 'ready', 0.9, 0.01, ?, ?)",
        )
        .bind(seededPieces.red, picturesAccount, now, now),
    )
    yield* database.batch(rows)
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

/** Clef as the picture job asks it: red is drawn and matches, green is drawn and is offered, blue is a fragment.
 * Anything else it is asked answers as Workers AI does on the native stack: unavailable. */
const clef = Effect.gen(function* () {
  const request = yield* HttpServerRequest
  const body = yield* Effect.flatMap(request.json, Schema.decodeUnknownEffect(ClefRequest))
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
      seed(database, media).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
    ),
    HttpRouter.add('POST', '/test/pictures/clef', clef),
    HttpRouter.add('POST', '/test/pictures/meta/v1/images/edits', muse(media)),
    HttpRouter.add('PUT', '/test/pictures/answer', answer(media)),
    HttpRouter.add('GET', '/test/pictures/prompts', prompts(media)),
    HttpRouter.add('POST', '/test/pictures/gateway/video-model/start', gateway(media).start),
    HttpRouter.add('POST', '/test/pictures/gateway/video-model/status', gateway(media).status),
  )
