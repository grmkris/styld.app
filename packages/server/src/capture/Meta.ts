import { Clock, Effect, Option, Predicate, Redacted, Schedule, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { type CaptureMetrics, counted, prices } from './Metrics.ts'
import { type Picture, ProviderFailed, ProviderOutcomeUnknown, type StoredVideo } from './Providers.ts'
import { lineFrame, lineFrameSize, makeOutputLines, stillMasks, videoMasks } from './SamStream.ts'
import { type ByteStream, pump } from './Streams.ts'

/** What the Meta adapter needs: the API, its key, a way to read stored videos, and `fetch`. Workers send
 * a streamed body with a known length only through `FixedLengthStream`, so the adapter uses `fetch`
 * directly rather than an HTTP client that would re-wrap the stream. */
export interface MetaSettings {
  readonly apiBase: string
  readonly apiKey: Redacted.Redacted
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
  readonly readVideo: (key: string) => Promise<ByteStream | null>
  readonly metrics: CaptureMetrics['Service']
}

const model = 'sam-3.1'
const failed = (retryable: boolean) => new ProviderFailed({ provider: 'meta-sam', retryable })
const unknown = () => new ProviderOutcomeUnknown({ provider: 'meta-sam' })

/** 4xx means Meta refused the request as sent. Throttling, server errors and `model_not_found` (Meta's
 * routing sometimes lands on a backend without the model; the next request usually reaches one) may
 * pass on a later try, and none of them was billed. */
const refusal = (response: Response) =>
  Effect.promise(() => response.text().catch(() => '')).pipe(
    Effect.flatMap((body) =>
      Effect.fail(
        failed(
          response.status === 408 ||
            response.status === 429 ||
            response.status >= 500 ||
            body.includes('"model_not_found"'),
        ),
      ),
    ),
  )

/** Retry a refusal worth retrying a few times in place before the queue's slower retry. */
const retriedBriefly = <A>(effect: Effect.Effect<A, ProviderFailed | ProviderOutcomeUnknown>) =>
  Effect.retry(effect, {
    times: 3,
    schedule: Schedule.exponential('400 millis'),
    while: (error) => Predicate.isTagged(error, 'ProviderFailed') && error.retryable,
  })

const FileCreated = Schema.Struct({ id: Schema.String })

/** Read a streamed Responses answer line by line, keeping the lines `keep` accepts. A stream that
 * breaks, or ends without `response.completed`, after Meta accepted the request is an unknown outcome. */
const readLines = (body: ByteStream, keep: (line: string) => boolean) =>
  Effect.tryPromise({
    try: async () => {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      const lines = makeOutputLines()
      const kept: Array<string> = []
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
        for (const line of lines.push(decoder.decode(chunk.value, { stream: true }))) if (keep(line)) kept.push(line)
      const end = lines.finish()
      for (const line of end.lines) if (keep(line)) kept.push(line)
      return { lines: kept, end: end.end }
    },
    catch: unknown,
  }).pipe(Effect.filterOrFail(({ end }) => end.completed, unknown))

const outcomeOf = (error: ProviderFailed | ProviderOutcomeUnknown) =>
  Predicate.isTagged(error, 'ProviderOutcomeUnknown') ? ('unknown' as const) : ('failed' as const)

/** Start a streamed Responses request. `onSendFailure` says what a request that never got an answer
 * means: safe to retry for a still, unknown for a video whose frames Meta may already be billing. */
const respond = (
  settings: MetaSettings,
  content: ReadonlyArray<object>,
  onSendFailure: () => ProviderFailed | ProviderOutcomeUnknown,
) =>
  Effect.tryPromise({
    try: () =>
      settings.fetch(`${settings.apiBase}/v1/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${Redacted.value(settings.apiKey)}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: true,
          input: [{ type: 'message', role: 'user', content }],
          metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
        }),
      }),
    catch: onSendFailure,
  }).pipe(
    Effect.flatMap((response) =>
      response.ok && response.body !== null ? Effect.succeed(response.body) : refusal(response),
    ),
    retriedBriefly,
  )

/** SAM on one still, sent inline. */
const segmentStill = (settings: MetaSettings) =>
  Effect.fn('Styld.Capture.segmentStill')(function* (picture: Picture, prompt: string) {
    const content = [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: `data:${picture.contentType};base64,${Base64.encode(picture.bytes)}` },
    ]
    return yield* counted(
      settings.metrics,
      respond(settings, content, () => failed(true)).pipe(
        Effect.flatMap((body) => readLines(body, () => true)),
        Effect.map(({ lines }) => stillMasks(lines)),
      ),
      { provider: 'meta-sam', model, kind: 'segment' },
      () => ({ units: 1, costMicroUsd: prices.samPerImage }),
      outcomeOf,
    )
  })

/** The multipart frame around a video's bytes. The boundary is one the video's bytes are vanishingly
 * unlikely to contain. */
const multipartFrame = (video: StoredVideo, nowMillis: number) => {
  const boundary = `styld-boundary-${nowMillis.toString(36)}-${video.bytes.toString(36)}`
  const encoder = new TextEncoder()
  const filename = `wardrobe${video.contentType === 'video/mp4' ? '.mp4' : '.mov'}`
  return {
    boundary,
    head: encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${video.contentType}\r\n\r\n`,
    ),
    tail: encoder.encode(`\r\n--${boundary}--\r\n`),
  }
}

/** Stream a stored video to Meta's Files API without holding it in memory. */
const sendVideo = (settings: MetaSettings, video: StoredVideo, frame: ReturnType<typeof multipartFrame>) =>
  Effect.tryPromise({
    try: async () => {
      const source = await settings.readVideo(video.key)
      if (source === null) throw new Error('The stored video is gone')
      const { readable, writable } = new FixedLengthStream(frame.head.byteLength + video.bytes + frame.tail.byteLength)
      const writer = writable.getWriter()
      const sending = (async () => {
        await writer.write(frame.head)
        await pump(source, { write: (chunk) => writer.write(chunk), close: () => Promise.resolve() })
        await writer.write(frame.tail)
        await writer.close()
      })()
      const answer = await settings.fetch(`${settings.apiBase}/v1/files`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${Redacted.value(settings.apiKey)}`,
          'content-type': `multipart/form-data; boundary=${frame.boundary}`,
        },
        // SAFETY: FixedLengthStream's readable is a Worker runtime stream -- the fetch type here is the DOM lib's, which names its own ReadableStream
        body: readable as never,
      })
      await sending
      return answer
    },
    catch: () => failed(true),
  })

/** Upload a stored video to Meta and return its file id. */
const uploadVideo = (settings: MetaSettings) =>
  Effect.fn('Styld.Capture.uploadVideo')(function* (video: StoredVideo) {
    const frame = multipartFrame(video, yield* Clock.currentTimeMillis)
    const response = yield* counted(
      settings.metrics,
      sendVideo(settings, video, frame),
      { provider: 'meta-sam', model: 'files', kind: 'upload' },
      () => ({ units: video.bytes, costMicroUsd: 0 }),
    )
    if (!response.ok) return yield* refusal(response)
    const created = yield* Effect.tryPromise({ try: () => response.json(), catch: () => failed(true) }).pipe(
      Effect.flatMap((json) =>
        Schema.decodeUnknownEffect(FileCreated)(json).pipe(Effect.mapError(() => failed(false))),
      ),
    )
    return created.id
  })

/** SAM through an uploaded video, keeping only the lines of the frames asked for. */
const trackVideo = (settings: MetaSettings) =>
  Effect.fn('Styld.Capture.trackVideo')(function* (fileId: string, prompt: string, frames: ReadonlySet<number>) {
    const content = [
      { type: 'input_text', text: prompt },
      { type: 'input_video', file_id: fileId },
    ]
    const wanted = (line: string) =>
      Option.match(Option.fromNullishOr(lineFrame(line)), { onNone: () => false, onSome: (frame) => frames.has(frame) })
    // Once the request left, Meta may have started billing frames: a lost answer is unknown, not retried.
    return yield* counted(
      settings.metrics,
      respond(settings, content, unknown).pipe(
        Effect.flatMap((body) => readLines(body, wanted)),
        Effect.map(({ lines, end }) => ({
          found: videoMasks(lines),
          framesBilled: end.framesBilled ?? 0,
          frameSize: lines.map(lineFrameSize).find((size) => size !== undefined),
        })),
      ),
      { provider: 'meta-sam', model, kind: 'track' },
      ({ framesBilled }) => ({ units: framesBilled, costMicroUsd: framesBilled * prices.samPerFrame }),
      outcomeOf,
    )
  })

/** Meta SAM 3.1 through `api.meta.ai`: stills inline, videos through the Files API. */
export const makeGarmentSegmenter = (settings: MetaSettings) => ({
  still: segmentStill(settings),
  upload: uploadVideo(settings),
  track: trackVideo(settings),
})
