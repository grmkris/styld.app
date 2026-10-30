import { Effect, Option, Predicate, Redacted, Schedule, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { cleanPrompt } from './CleanPrompt.ts'
import { profilePrompt } from './TurnPrompt.ts'
import { type CaptureMetrics, counted, prices } from './Metrics.ts'
import { type DrawRequest, type Picture, ProviderFailed, ProviderOutcomeUnknown } from './Providers.ts'

/** What the Muse adapter needs: Meta's API and the key Styld already uses for SAM, and `fetch`. */
export interface MuseSettings {
  readonly apiBase: string
  readonly apiKey: Redacted.Redacted
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
  readonly metrics: CaptureMetrics['Service']
}

/** Meta's Standard model: Contributor variants would let Meta train on the person's garments. */
const model = 'muse-image-1.0'
const failed = (retryable: boolean) => new ProviderFailed({ provider: 'meta-muse', retryable })
const unknown = () => new ProviderOutcomeUnknown({ provider: 'meta-muse' })

const Edited = Schema.Struct({ data: Schema.Array(Schema.Struct({ b64_json: Schema.optionalKey(Schema.String) })) })

const dataUrl = (picture: Picture) => `data:${picture.contentType};base64,${Base64.encode(picture.bytes)}`

/** An edit request: the pictures in order, Muse's own search tools off so nothing beyond them reaches it, a portrait
 * picture returned as base64 PNG. */
const body = (prompt: string, pictures: ReadonlyArray<Picture>, size: string) =>
  JSON.stringify({
    model,
    prompt,
    images: pictures.map((picture) => ({ image_url: dataUrl(picture) })),
    n: 1,
    size,
    output_format: 'png',
    response_format: 'b64_json',
    reasoning_strength: 'high',
    tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  })

/** The clean picture's request: the front first and the back second, 2:3. */
const drawBody = (request: DrawRequest) =>
  body(
    cleanPrompt({ key: request.key, hasBack: Option.isSome(request.back), hint: Option.getOrUndefined(request.hint) }),
    [request.front, ...Option.toArray(request.back)],
    '1024x1536',
  )

/** Throttling and server errors were not billed and may pass on a later try; any other refusal would repeat. */
const refusal = (response: Response) =>
  Effect.fail(failed(response.status === 408 || response.status === 429 || response.status >= 500))

/** The drawn picture in Muse's answer. No picture means Meta's safety filter removed it, unbilled and final; an
 * answer Styld cannot read would read the same way again. */
const pictureOf = (response: Response) =>
  Effect.tryPromise({ try: () => response.json(), catch: unknown }).pipe(
    Effect.flatMap((json) => Schema.decodeUnknownEffect(Edited)(json).pipe(Effect.mapError(() => failed(false)))),
    Effect.flatMap(({ data }) => Effect.fromNullishOr(data[0]?.b64_json).pipe(Effect.mapError(() => failed(false)))),
    Effect.flatMap((encoded) => Effect.fromResult(Base64.decode(encoded)).pipe(Effect.mapError(() => failed(false)))),
    Effect.map((bytes): Picture => ({ bytes, contentType: 'image/png' })),
  )

const outcomeOf = (error: ProviderFailed | ProviderOutcomeUnknown) =>
  Predicate.isTagged(error, 'ProviderOutcomeUnknown') ? ('unknown' as const) : ('failed' as const)

/** One Muse edit, retried in place while Muse is busy, counted as `kind`. A request that was sent but got no answer may
 * have been drawn and billed, so it is unknown and never resent. */
const edit = (settings: MuseSettings, request: string, kind: 'draw' | 'profile') => {
  const send = Effect.tryPromise({
    try: (signal) =>
      settings.fetch(`${settings.apiBase}/v1/images/edits`, {
        method: 'POST',
        headers: { authorization: `Bearer ${Redacted.value(settings.apiKey)}`, 'content-type': 'application/json' },
        body: request,
        signal,
      }),
    catch: unknown,
  }).pipe(Effect.flatMap((response) => (response.ok ? pictureOf(response) : refusal(response))))
  return counted(
    settings.metrics,
    send.pipe(
      Effect.retry({
        times: 3,
        schedule: Schedule.exponential('400 millis'),
        while: (error) => Predicate.isTagged(error, 'ProviderFailed') && error.retryable,
      }),
      Effect.timeoutOrElse({ duration: '90 seconds', orElse: () => Effect.fail(unknown()) }),
    ),
    { provider: 'meta-muse', model, kind },
    () => ({ units: 1, costMicroUsd: prices.musePerImage }),
    outcomeOf,
  )
}

/** Meta Muse Image as Styld's image generator: clean pictures, and the side views turns start from. */
export const makeMuseGenerator = (settings: MuseSettings) => ({
  provider: 'meta-muse',
  model,
  draw: Effect.fn('Styld.Picture.draw')(function* (request: DrawRequest) {
    return yield* edit(settings, drawBody(request), 'draw')
  }),
  /** A strict side view of a turn's front anchor, on the same 9:16 canvas. */
  profile: Effect.fn('Styld.Turn.profile')(function* (front: Picture, key: 'green' | 'magenta') {
    return yield* edit(settings, body(profilePrompt(key), [front], '1152x2048'), 'profile')
  }),
})
