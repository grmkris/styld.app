import { readFileSync } from 'node:fs'
import { Effect, Predicate, Redacted, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeGarmentVision } from '../src/capture/Clef.ts'
import { turnKept } from '../src/capture/CleanPicture.ts'
import { capturePolicy } from '../src/capture/Policy.ts'
import { CaptureMetrics } from '../src/capture/Metrics.ts'
import { makeMuseGenerator } from '../src/capture/Muse.ts'
import { makeVeoGenerator } from '../src/capture/Veo.ts'

const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))
const picture = (byte: number) => ({ bytes: new Uint8Array([byte, byte]), contentType: 'image/png' }) as const
const turn = { side: picture(1), front: picture(2), key: 'magenta' } as const

/** A provider answering each call in turn, and the requests it saw. */
const answering = (...answers: ReadonlyArray<() => Promise<Response>>) => {
  const seen: Array<{ readonly url: string; readonly init: RequestInit }> = []
  const fetch = (url: string, init: RequestInit) => {
    seen.push({ url, init })
    const next = answers[Math.min(seen.length - 1, answers.length - 1)]
    return next === undefined ? Promise.reject(new Error('no answer')) : next()
  }
  return { seen, fetch }
}

const veo = (...answers: ReadonlyArray<() => Promise<Response>>) => {
  const provider = answering(...answers)
  const generator = makeVeoGenerator({
    apiBase: 'https://gateway.test/v4/ai',
    apiKey: Redacted.make('key'),
    fetch: provider.fetch,
    metrics: CaptureMetrics.discarding,
  })
  return { generator, seen: provider.seen }
}

const status =
  (code: number, body: unknown = {}) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status: code }))

const SentStart = Schema.fromJsonString(
  Schema.Struct({
    prompt: Schema.String,
    duration: Schema.Number,
    aspectRatio: Schema.String,
    resolution: Schema.String,
    generateAudio: Schema.Boolean,
    frameImages: Schema.Array(
      Schema.Struct({ frameType: Schema.String, image: Schema.Struct({ type: Schema.String, data: Schema.String }) }),
    ),
  }),
)

describe('Veo 3.1 Lite through the Vercel AI Gateway', () => {
  test('starts a 4 s portrait turn from the side view to the front, and keeps the job the gateway answers', async () => {
    const { generator, seen } = veo(() => Promise.resolve(new Response(fixture('veo-start-black-tee.json'))))
    const operation = await Effect.runPromise(generator.start(turn))
    expect(operation).toEqual({ gatewayJobId: 'job_0BYEYWZRW9C4TACYDWV4CPB1F6' })
    expect(seen[0]?.url).toBe('https://gateway.test/v4/ai/video-model/start')
    const headers = new Headers(seen[0]?.init.headers)
    expect([headers.get('authorization'), headers.get('ai-model-id')]).toEqual([
      'Bearer key',
      'google/veo-3.1-lite-generate-001',
    ])
    const sent = Schema.decodeUnknownSync(SentStart)(seen[0]?.init.body)
    expect(sent).toMatchObject({ duration: 4, aspectRatio: '9:16', resolution: '1280x720', generateAudio: false })
    expect(sent.frameImages.map(({ frameType, image }) => [frameType, image.type, image.data])).toEqual([
      ['first_frame', 'file', 'AQE='],
      ['last_frame', 'file', 'AgI='],
    ])
    expect(sent.prompt).toContain('Keep the flat magenta background completely uniform.')
  })

  test('tries a throttled start again, never resends one whose answer was lost, and takes a refusal as final', async () => {
    const throttled = veo(status(429))
    expect(await Effect.runPromise(Effect.flip(throttled.generator.start(turn)))).toMatchObject({
      _tag: 'ProviderFailed',
      retryable: true,
    })
    expect(throttled.seen).toHaveLength(3)
    const lost = veo(() => Promise.reject(new Error('reset')))
    expect(await Effect.runPromise(Effect.flip(lost.generator.start(turn)))).toMatchObject({
      _tag: 'ProviderOutcomeUnknown',
    })
    expect(lost.seen).toHaveLength(1)
    const refused = veo(status(400))
    expect(await Effect.runPromise(Effect.flip(refused.generator.start(turn)))).toMatchObject({ retryable: false })
  })

  test('reads a job as pending, done with its video fetched, or failed', async () => {
    const operation = { gatewayJobId: 'job_1' }
    const pending = veo(status(200, { status: 'pending' }))
    expect(await Effect.runPromise(pending.generator.status(operation))).toEqual({ _tag: 'Pending' })
    expect(pending.seen[0]?.init.body).toBe(JSON.stringify({ operation }))
    const video = new Uint8Array(fixture('tiny-rail.mp4'))
    const done = veo(
      status(200, {
        status: 'completed',
        videos: [{ type: 'url', url: 'https://videos.test/a.mp4', mediaType: 'video/mp4' }],
      }),
      () => Promise.resolve(new Response(video)),
    )
    const finished = await Effect.runPromise(done.generator.status(operation))
    expect(Predicate.isTagged(finished, 'Done') ? finished.video.bytes.byteLength : 0).toBe(video.byteLength)
    expect(done.seen[1]?.url).toBe('https://videos.test/a.mp4')
    expect(
      await Effect.runPromise(veo(status(200, { status: 'error', error: 'filtered' })).generator.status(operation)),
    ).toEqual({ _tag: 'Failed' })
    expect(await Effect.runPromise(Effect.flip(veo(status(503)).generator.status(operation)))).toMatchObject({
      retryable: true,
    })
  })
})

describe("Muse's side view", () => {
  test('turns the front anchor to a strict profile on the same 9:16 canvas', async () => {
    const provider = answering(() => Promise.resolve(new Response(fixture('muse-edit-red-tee.json'))))
    const muse = makeMuseGenerator({
      apiBase: 'https://meta.test',
      apiKey: Redacted.make('key'),
      fetch: provider.fetch,
      metrics: CaptureMetrics.discarding,
    })
    await Effect.runPromise(muse.profile(picture(3), 'green'))
    const sent = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({ prompt: Schema.String, size: Schema.String, images: Schema.Array(Schema.Unknown) }),
      ),
    )(provider.seen[0]?.init.body)
    expect(sent.size).toBe('1152x2048')
    expect(sent.images).toHaveLength(1)
    expect(sent.prompt).toContain('Show a strict side profile')
    expect(sent.prompt).toContain('flat green #00ff00 background')
  })
})

describe("the decision model on a turn's frame", () => {
  test('asks whether the frame keeps the garment, its colour and its print, beside the clean front', async () => {
    const asked: Array<unknown> = []
    const vision = makeGarmentVision((request) => {
      asked.push(request)
      return Promise.resolve({
        model: 'clef-flash',
        answers: { same: { noul: 0.91 }, colour: { noul: 0.88 }, print: { noul: 0.71 }, printed: { noul: 0.93 } },
      })
    }, CaptureMetrics.discarding)
    expect(await Effect.runPromise(vision.compareTurn(picture(1), picture(2)))).toEqual({
      same: 0.91,
      colour: 0.88,
      print: 0.71,
      printed: 0.93,
    })
    expect(asked[0]).toMatchObject({ questions: { same: {}, colour: {}, print: {}, printed: {} } })
  })
})

/** A checked frame of a turn, as Clef answers it. */
const frame = (colour: number, print: number, printed: number) => ({ same: 0.8, colour, print, printed })

describe("a turn's gate", () => {
  const policy = capturePolicy({}).turns
  test('keeps colour on every frame, and the print only for a garment that has one', () => {
    // Plain navy trousers on the preview: colour kept, no print to keep.
    expect(turnKept([frame(0.93, 0.06, 0.05), frame(0.95, 0.1, 0.02), frame(0.94, 0.2, 0.1)], policy)).toBe(true)
    expect(turnKept([frame(0.93, 0.9, 0.9), frame(0.92, 0.4, 0.9), frame(0.95, 0.8, 0.8)], policy)).toBe(false)
    expect(turnKept([frame(0.93, 0.9, 0.9), frame(0.79, 0.9, 0.9), frame(0.95, 0.8, 0.8)], policy)).toBe(false)
    expect(turnKept([frame(0.93, 0.7, 0.9), frame(0.92, 0.6, 0.9), frame(0.95, 0.8, 0.2)], policy)).toBe(true)
  })
})
