import { busy, refused, outcomeUnknown, broken, reasonOfStatus } from '../providers/Errors.ts'
import { costs } from '../providers/Costs.ts'
import { deadlines, providerCall } from '../providers/Call.ts'
import { Effect, Option, Redacted, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import type { CaptureMetrics } from './Metrics.ts'
import { type Picture, type TurnRequest, type TurnStatus } from './Providers.ts'
import { turnPrompt } from './TurnPrompt.ts'

/** What the Veo adapter needs: the Vercel AI Gateway, its key, and `fetch`. */
export interface VeoSettings {
  readonly apiBase: string
  readonly apiKey: Redacted.Redacted
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
  readonly metrics: CaptureMetrics['Service']
  /** How often a turn being made is asked about. */
  readonly pollSeconds: number
}

/** Veo answers a 4 s turn in one to two minutes (30 October): asking every 15 s finds it soon after. */
export const veoPollSeconds = 15

/** The Vercel AI Gateway's video model endpoints. */
export const gatewayBase = 'https://ai-gateway.vercel.sh/v4/ai'

// Veo 3.1 Lite: the 30 October comparison kept prints and colours as well as Veo 3.1 Fast at $0.12 a 4 s take
// instead of $0.40; both Seedance models drifted (`meta-hackathon/out/styld-clean-turn/REPORT-turn-models.md`).
const model = 'google/veo-3.1-lite-generate-001'
const seconds = 4
const failed = (retryable: boolean) => (retryable ? busy('vercel-gateway') : refused('vercel-gateway'))
const unknown = () => outcomeUnknown('vercel-gateway')

const Started = Schema.Struct({ operation: Schema.Unknown })
const Video = Schema.Union([
  Schema.Struct({ type: Schema.Literal('url'), url: Schema.String, mediaType: Schema.String }),
  Schema.Struct({ type: Schema.Literal('base64'), data: Schema.String, mediaType: Schema.String }),
])
const Status = Schema.Union([
  Schema.Struct({ status: Schema.Literal('pending') }),
  Schema.Struct({ status: Schema.Literal('completed'), videos: Schema.Array(Video) }),
  Schema.Struct({ status: Schema.Literals(['error', 'cancelled']) }),
])

/** The gateway's video protocol (AI SDK `@ai-sdk/gateway` 4, video model specification 4), called directly so the
 * Worker carries no SDK. */
const headers = (settings: VeoSettings) => ({
  authorization: `Bearer ${Redacted.value(settings.apiKey)}`,
  'content-type': 'application/json',
  'ai-gateway-protocol-version': '0.0.1',
  'ai-gateway-auth-method': 'api-key',
  'ai-video-model-specification-version': '4',
  'ai-model-id': model,
})

const frame = (picture: Picture, frameType: 'first_frame' | 'last_frame') => ({
  frameType,
  image: { type: 'file', mediaType: picture.contentType, data: Base64.encode(picture.bytes) },
})

/** The start request: 4 s, portrait 720p, no sound, no people, first frame the side view, last frame the front. */
const startBody = (request: TurnRequest) =>
  JSON.stringify({
    prompt: turnPrompt(request.key),
    n: 1,
    aspectRatio: '9:16',
    resolution: '1280x720',
    duration: seconds,
    generateAudio: false,
    providerOptions: { vertex: { personGeneration: 'dont_allow', resizeMode: 'pad' } },
    frameImages: [frame(request.side, 'first_frame'), frame(request.front, 'last_frame')],
  })

/** Throttling and server errors were not billed and may pass on a later try; any other refusal would repeat. */

const post = (settings: VeoSettings, path: string, body: string) =>
  Effect.tryPromise({
    try: (signal) =>
      settings.fetch(`${settings.apiBase}/video-model/${path}`, {
        method: 'POST',
        headers: headers(settings),
        body,
        signal,
      }),
    catch: unknown,
  })

const json = (response: Response) => Effect.tryPromise({ try: () => response.json(), catch: () => failed(true) })

/** A finished video's bytes: fetched from where the gateway put it, or decoded when it came inline. */
const videoOf = (settings: VeoSettings, video: typeof Video.Type) =>
  video.type === 'base64'
    ? Effect.fromResult(Base64.decode(video.data)).pipe(Effect.mapError(() => broken('vercel-gateway')))
    : Effect.tryPromise({
        try: async (signal) => {
          const response = await settings.fetch(video.url, { method: 'GET', signal })
          if (!response.ok) throw new Error(String(response.status))
          return new Uint8Array(await response.arrayBuffer())
        },
        catch: () => failed(true),
      }).pipe(Effect.timeoutOrElse({ duration: '60 seconds', orElse: () => Effect.fail(failed(true)) }))

const GatewayError = Schema.Struct({ error: Schema.Struct({ type: Schema.String }) })

/** A refused request, with its status and the gateway's error type on the span (both bounded, neither secret): the
 * only way to tell a key the gateway turned down from a request it could not take. */
const refusal = (response: Response) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise(() => response.json()).pipe(Effect.orElseSucceed(() => undefined))
    const type = Schema.decodeUnknownOption(GatewayError)(body).pipe(Option.map(({ error }) => error.type.slice(0, 40)))
    yield* Effect.annotateCurrentSpan({
      'styld.provider.status': response.status,
      'styld.provider.error': Option.getOrElse(type, () => 'unknown'),
    })
    yield* Effect.logWarning('Styld.Turn refused').pipe(
      Effect.annotateLogs({
        'styld.provider.status': response.status,
        'styld.provider.error': Option.getOrElse(type, () => 'unknown'),
      }),
    )
    return yield* reasonOfStatus('vercel-gateway', response.status)
  })

/** Veo 3.1 Lite through the Vercel AI Gateway as Styld's turn maker. A start that was sent but got no answer may have
 * made and billed a job, so it is unknown and never resent; the job's id is kept before it is polled. */
export const makeVeoGenerator = (settings: VeoSettings) => ({
  provider: 'vercel-gateway',
  model,
  pollSeconds: settings.pollSeconds,
  start: Effect.fn('Styld.Turn.start')(function* (request: TurnRequest) {
    const send = post(settings, 'start', startBody(request)).pipe(
      Effect.flatMap((response) => (response.ok ? json(response) : refusal(response))),
      Effect.flatMap((answer) => Schema.decodeUnknownEffect(Started)(answer).pipe(Effect.mapError(unknown))),
      Effect.map(({ operation }) => operation),
    )
    return yield* providerCall(
      settings.metrics,
      { provider: 'vercel-gateway', model, kind: 'turn', deadline: deadlines.turn, replaySafe: false },
      send,
      () => ({ units: seconds, costMicroUsd: seconds * costs.veoLitePerSecond }),
    )
  }),
  /** Where a started job stands. A status the gateway could not give now is retryable; the job itself is untouched. */
  status: Effect.fn('Styld.Turn.status')(function* (operation: unknown) {
    const response = yield* post(settings, 'status', JSON.stringify({ operation })).pipe(
      Effect.mapError(() => failed(true)),
      Effect.timeoutOrElse({ duration: deadlines.status, orElse: () => Effect.fail(failed(true)) }),
    )
    if (!response.ok) return yield* reasonOfStatus('vercel-gateway', response.status)
    const answer = yield* Effect.flatMap(json(response), (body) =>
      Schema.decodeUnknownEffect(Status)(body).pipe(Effect.mapError(() => broken('vercel-gateway'))),
    )
    if (answer.status === 'pending') return { _tag: 'Pending' } satisfies TurnStatus
    if (answer.status !== 'completed') return { _tag: 'Failed' } satisfies TurnStatus
    const [video] = answer.videos
    if (video === undefined) return { _tag: 'Failed' } satisfies TurnStatus
    const bytes = yield* videoOf(settings, video)
    return { _tag: 'Done', video: { bytes, contentType: 'video/mp4' } } satisfies TurnStatus
  }),
})
