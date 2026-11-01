import { refused, broken } from '../providers/Errors.ts'
import { costs } from '../providers/Costs.ts'
import { deadlines, providerCall } from '../providers/Call.ts'
import { dataUrl, httpProvider, type HttpProvider, type HttpProviderSettings } from '../providers/Http.ts'
import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { cleanPrompt } from './CleanPrompt.ts'
import { profilePrompt } from './TurnPrompt.ts'
import type { CaptureMetrics } from './Metrics.ts'
import type { PaintRequest } from '../generation/Painter.ts'
import { type DrawRequest, type Picture } from './Providers.ts'

/** What the Muse adapter needs: Meta's API and the key Styld already uses for SAM, `fetch`, and the call counter. */
export interface MuseSettings extends Omit<HttpProviderSettings, 'provider'> {
  readonly metrics: CaptureMetrics['Service']
}

/** Meta's Standard model: Contributor variants would let Meta train on the person's garments. */
const model = 'muse-image-1.0'

const Edited = Schema.Struct({ data: Schema.Array(Schema.Struct({ b64_json: Schema.optionalKey(Schema.String) })) })

/** An edit request: the pictures in order, Muse's own search tools off so nothing beyond them reaches it, a portrait
 * picture returned as base64 PNG. With no pictures it is a request to draw from the words alone. */
const body = (prompt: string, pictures: ReadonlyArray<Picture>, size: string) => ({
  model,
  prompt,
  ...(pictures.length === 0 ? {} : { images: pictures.map((picture) => ({ image_url: dataUrl(picture) })) }),
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

/** The drawn picture in Muse's answer. No picture means Meta's safety filter removed it, unbilled and final; an
 * answer Styld cannot read would read the same way again. */
const pictureOf = (http: HttpProvider, response: Response) =>
  http.json(response, 'unknown').pipe(
    Effect.flatMap((json) => Schema.decodeUnknownEffect(Edited)(json).pipe(Effect.mapError(() => broken('meta-muse')))),
    Effect.flatMap(({ data }) =>
      Effect.fromNullishOr(data[0]?.b64_json).pipe(Effect.mapError(() => refused('meta-muse'))),
    ),
    Effect.flatMap((encoded) =>
      Effect.fromResult(Base64.decode(encoded)).pipe(Effect.mapError(() => broken('meta-muse'))),
    ),
    Effect.map((bytes): Picture => ({ bytes, contentType: 'image/png' })),
  )

/** One Muse edit, retried in place while Muse is busy, counted as `kind`. A request that was sent but got no answer may
 * have been drawn and billed, so it is unknown and never resent. */
const edit = (
  settings: MuseSettings,
  request: object,
  kind: 'draw' | 'profile' | 'paint',
  endpoint: 'edits' | 'generations' = 'edits',
) => {
  const http = httpProvider({ ...settings, provider: 'meta-muse' })
  const send = http
    .postJson(`/v1/images/${endpoint}`, request, 'unknown')
    .pipe(Effect.flatMap((response) => (response.ok ? pictureOf(http, response) : http.refusal(response))))
  return providerCall(
    settings.metrics,
    { provider: 'meta-muse', model, kind, deadline: deadlines.draw, replaySafe: false },
    send,
    () => ({ units: 1, costMicroUsd: costs.musePerImage }),
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

/** Meta Muse Image as the painter of a board's stickers: from the words alone, square, on a flat key colour. */
export const makeMusePainter = (settings: MuseSettings) => ({
  model,
  paint: Effect.fn('Styld.Generation.paint')(function* (request: PaintRequest) {
    return yield* edit(settings, body(request.prompt, [], '1024x1024'), 'paint', 'generations')
  }),
})
