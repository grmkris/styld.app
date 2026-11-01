import { busy, refused, outcomeUnknown, broken } from '../providers/Errors.ts'
import { costs } from '../providers/Costs.ts'
import { deadlines, providerCall } from '../providers/Call.ts'
import { dataUrl, httpProvider, type HttpProvider, type HttpProviderSettings } from '../providers/Http.ts'
import { Clock, Effect, Option, Schema } from 'effect'
import type { CaptureMetrics } from './Metrics.ts'
import { type Picture, type StoredVideo } from './Providers.ts'
import { lineFrame, lineFrameSize, makeOutputLines, stillMasks, videoMasks } from './SamStream.ts'
import { type ByteStream, pump } from '../Streams.ts'
import { blankRanges } from './VideoContainer.ts'

/** What the Meta adapter needs: the API, its key and `fetch`, a way to read stored videos, and the call counter.
 * Workers send a streamed body with a known length only through `FixedLengthStream`, which the client passes on as it
 * is. */
export interface MetaSettings extends Omit<HttpProviderSettings, 'provider' | 'headers'> {
  readonly readVideo: (key: string) => Promise<ByteStream | null>
  readonly metrics: CaptureMetrics['Service']
}

const model = 'sam-3.1'
const failed = (retryable: boolean) => (retryable ? busy('meta-sam') : refused('meta-sam'))
const unknown = () => outcomeUnknown('meta-sam')

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

/** Start a streamed Responses request. A request that never got an answer may have reached Meta, which bills a still
 * and a video's frames once it takes them: its outcome is unknown, and it is never sent again on its own. */
const respond = (http: HttpProvider, content: ReadonlyArray<object>) =>
  http
    .postJson(
      '/v1/responses',
      {
        model,
        stream: true,
        input: [{ type: 'message', role: 'user', content }],
        metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      },
      'unknown',
    )
    .pipe(
      Effect.flatMap((response) =>
        response.ok && response.body !== null ? Effect.succeed(response.body) : refusal(response),
      ),
    )

/** SAM on one still, sent inline. */
const segmentStill = (settings: MetaSettings, http: HttpProvider) =>
  Effect.fn('Styld.Capture.segmentStill')(function* (picture: Picture, prompt: string) {
    const content = [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: dataUrl(picture) },
    ]
    return yield* providerCall(
      settings.metrics,
      { provider: 'meta-sam', model, kind: 'segment', deadline: deadlines.segment, replaySafe: false },
      respond(http, content).pipe(
        Effect.flatMap((body) => readLines(body, () => true)),
        // An answer SAM sent but Styld cannot read would read the same way again.
        Effect.flatMap(({ lines }) => Effect.try({ try: () => stillMasks(lines), catch: () => broken('meta-sam') })),
      ),
      () => ({ units: 1, costMicroUsd: costs.samPerImage }),
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

/** Stream a stored video to Meta's Files API without holding it in memory, its metadata blanked on the
 * way. A read that fails midway aborts the request rather than leaving it waiting for bytes. */
const sendVideo = (
  settings: MetaSettings,
  http: HttpProvider,
  video: StoredVideo,
  frame: ReturnType<typeof multipartFrame>,
) =>
  Effect.gen(function* () {
    const source = yield* Effect.tryPromise({ try: () => settings.readVideo(video.key), catch: () => failed(true) })
    // The stored video is gone; trying again cannot bring it back.
    if (source === null) return yield* failed(false)
    const { readable, writable } = new FixedLengthStream(frame.head.byteLength + video.bytes + frame.tail.byteLength)
    const writer = writable.getWriter()
    let offset = 0
    const sending = Effect.tryPromise({
      try: () =>
        (async () => {
          await writer.write(frame.head)
          await pump(source, {
            write: (chunk) => {
              const blanked = blankRanges(chunk, offset, video.metadata)
              offset += chunk.byteLength
              return writer.write(blanked)
            },
            close: () => Promise.resolve(),
          })
          await writer.write(frame.tail)
          await writer.close()
        })().catch(async (error: unknown) => {
          await writer.abort(error)
          throw error
        }),
      catch: () => failed(true),
    })
    const [answer] = yield* Effect.all(
      [
        http.send('/v1/files', {
          method: 'POST',
          contentType: `multipart/form-data; boundary=${frame.boundary}`,
          // SAFETY: FixedLengthStream's readable is a Worker runtime stream -- the fetch type here is the DOM lib's, which names its own ReadableStream
          body: readable as never,
          lost: 'busy',
        }),
        sending,
      ],
      { concurrency: 'unbounded' },
    )
    return answer
  })

/** Upload a stored video to Meta and return its file id. */
const uploadVideo = (settings: MetaSettings, http: HttpProvider) =>
  Effect.fn('Styld.Capture.uploadVideo')(function* (video: StoredVideo) {
    const frame = multipartFrame(video, yield* Clock.currentTimeMillis)
    // Uploading is free and uploading again only makes another file: safe to send again.
    const response = yield* providerCall(
      settings.metrics,
      { provider: 'meta-sam', model: 'files', kind: 'upload', deadline: deadlines.upload, replaySafe: true },
      sendVideo(settings, http, video, frame),
      () => ({ units: video.bytes, costMicroUsd: 0 }),
    )
    if (!response.ok) return yield* refusal(response)
    const created = yield* Effect.tryPromise({ try: () => response.json(), catch: () => failed(true) }).pipe(
      Effect.flatMap((json) =>
        Schema.decodeUnknownEffect(FileCreated)(json).pipe(Effect.mapError(() => broken('meta-sam'))),
      ),
    )
    return created.id
  })

/** SAM through an uploaded video, keeping only the lines of the frames asked for. */
const trackVideo = (settings: MetaSettings, http: HttpProvider) =>
  Effect.fn('Styld.Capture.trackVideo')(function* (fileId: string, prompt: string, frames: ReadonlySet<number>) {
    const content = [
      { type: 'input_text', text: prompt },
      { type: 'input_video', file_id: fileId },
    ]
    const wanted = (line: string) =>
      Option.match(Option.fromNullishOr(lineFrame(line)), { onNone: () => false, onSome: (frame) => frames.has(frame) })
    // Once the request left, Meta may have started billing frames: a lost answer is unknown, not retried.
    return yield* providerCall(
      settings.metrics,
      { provider: 'meta-sam', model, kind: 'track', deadline: deadlines.track, replaySafe: false },
      respond(http, content).pipe(
        Effect.flatMap((body) => readLines(body, wanted)),
        // Meta billed the frames once it answered: an answer Styld cannot read is an unknown outcome.
        Effect.flatMap(({ lines, end }) =>
          Effect.try({
            try: () => ({
              found: videoMasks(lines),
              framesBilled: end.framesBilled ?? 0,
              frameSize: lines.map(lineFrameSize).find((size) => size !== undefined),
            }),
            catch: unknown,
          }),
        ),
      ),
      ({ framesBilled }) => ({ units: framesBilled, costMicroUsd: framesBilled * costs.samPerFrame }),
    )
  })

/** Delete an uploaded video at Meta. Tracking already settled, so a failure is only logged. */
const forgetVideo = (http: HttpProvider) =>
  Effect.fn('Styld.Capture.forgetVideo')(function* (fileId: string) {
    yield* http
      .send(`/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', lost: 'busy' })
      .pipe(
        Effect.timeoutOrElse({ duration: '30 seconds', orElse: () => Effect.fail(failed(true)) }),
        Effect.ignore({ log: true, message: 'Styld.Capture.forgetVideo could not delete a video at Meta' }),
      )
  })

/** Meta SAM 3.1 through `api.meta.ai`: stills inline, videos through the Files API, deleted once tracked. */
/** Meta's API. */
export const metaBase = 'https://api.meta.ai'

export const makeGarmentSegmenter = (settings: MetaSettings) => {
  const http = httpProvider({ ...settings, provider: 'meta-sam' })
  return {
    still: segmentStill(settings, http),
    upload: uploadVideo(settings, http),
    track: trackVideo(settings, http),
    forget: forgetVideo(http),
  }
}
