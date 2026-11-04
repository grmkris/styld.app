import { refused, broken } from './Errors.ts'
import { costs } from './Costs.ts'
import { deadlines, providerCall } from './Call.ts'
import { dataUrl, httpProvider, type HttpProvider, type HttpProviderSettings } from './Http.ts'
import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { cleanPrompt } from '../capture/CleanPrompt.ts'
import { profilePrompt } from '../capture/TurnPrompt.ts'
import type { CaptureMetrics } from '../kernel/Metrics.ts'
import type { PaintRequest } from '../generation/Painter.ts'
import { tryOnPrompt } from '../generation/TryOnPrompt.ts'
import type { TryOnRequest } from '../generation/TryOnPainter.ts'
import { type DrawRequest, type Picture } from '../capture/Providers.ts'

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

/** The clean picture's request, 2:3: the side it shows first and the other side second; or, after a refusal, the
 * piece's photo first and the cut-out second. */
const drawBody = (request: DrawRequest) => {
  const fromPhoto = Option.isSome(request.photo)
  const other = fromPhoto ? Option.none() : request.other
  return body(
    cleanPrompt({
      key: request.key,
      side: request.side,
      type: request.type,
      colours: request.colours,
      fromPhoto,
      hasOther: Option.isSome(other),
      hint: Option.getOrUndefined(request.hint),
    }),
    [...Option.toArray(request.photo), request.subject, ...Option.toArray(other)],
    '1024x1536',
  )
}

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
  kind: 'draw' | 'profile' | 'paint' | 'tryOn',
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

/** The sizes Muse draws from words at: square for a sticker, 2:3 for a long house garment. */
export type PaintSize = '1024x1024' | '1024x1536'

/** Meta Muse Image as the painter of a board's stickers (from the words alone, square, on a flat key colour), and of
 * the house garments the operator's seed generates (`tools/seed/`), one per picture. */
export const makeMusePainter = (settings: MuseSettings) => ({
  paint: Effect.fn('Styld.Generation.paint')(function* (request: PaintRequest, size: PaintSize = '1024x1024') {
    return yield* edit(settings, body(request.prompt, [], size), 'paint', 'generations')
  }),
})

/** A try-on's request: the person's photo first, then each piece's picture, named in that order (`TryOnPrompt.ts`).
 * Muse takes at most ten pictures, which `maximumTryOnPieces` keeps to.
 * @internal Exported for its tests. */
export const tryOnBody = (request: TryOnRequest) =>
  body(
    tryOnPrompt(request.pieces.map(({ words }) => words)),
    [request.photo, ...request.pieces.map(({ picture }) => picture)],
    request.size,
  )

/** Meta Muse Image as the painter of try-ons: the only call that sends one of the person's own photos out, and only
 * one they said shows them (`generation/TryOn.ts`). */
export const makeMuseTryOn = (settings: MuseSettings) => ({
  tryOn: Effect.fn('Styld.TryOn.draw')(function* (request: TryOnRequest) {
    return yield* edit(settings, tryOnBody(request), 'tryOn')
  }),
})
