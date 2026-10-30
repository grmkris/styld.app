import { decodePng, type Rgba } from '@styld/imaging'
import { CaptureUnavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { accountPrefix, piecePrefix } from '../wardrobe/Media.ts'
import type { WorkMessage } from '../wardrobe/Processing.ts'
import { makeStore } from '../wardrobe/Store.ts'
import type { WardrobeBindings } from '../wardrobe/Wardrobe.ts'
import { makeCaptureStore } from './Store.ts'

/** The Cloudflare bindings captures read and write. */
export interface CaptureBindings {
  readonly database: WardrobeBindings['database']
  readonly bucket: WardrobeBindings['bucket']
  readonly queue: { send(message: WorkMessage, options?: { readonly delaySeconds?: number }): Promise<unknown> }
}

export const unavailable = () => CaptureUnavailable.make({})

/** What every capture operation shares: stores, bindings, ids and digests. */
export const makeParts = (bindings: CaptureBindings) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const encoder = new TextEncoder()
    const randomId = (prefix: 'cp' | 'dt' | 'pc') =>
      crypto.randomBytes(16).pipe(
        Effect.map((bytes) => `${prefix}_${Base64Url.encode(bytes)}`),
        Effect.mapError(unavailable),
      )
    return {
      bindings,
      store: makeCaptureStore(bindings.database),
      wardrobeStore: makeStore(bindings.database),
      randomId,
      digest: (text: string) =>
        crypto.digest('SHA-256', encoder.encode(text)).pipe(Effect.map(Base64Url.encode), Effect.mapError(unavailable)),
    }
  })
export type Parts = Effect.Success<ReturnType<typeof makeParts>>

/** Where a capture's own objects live, under the account's prefix so deletion sweeps them. */
export const captureKey = (accountId: string, captureId: string, name: string) =>
  `${accountPrefix(accountId)}captures/${captureId}/${name}`

/** A stored object's bytes, or none when it is gone. */
export const readObject = (parts: Parts, key: string) =>
  Effect.tryPromise({
    try: async () => {
      const object = await parts.bindings.bucket.get(key)
      return object === null ? Option.none<Uint8Array>() : Option.some(new Uint8Array(await object.arrayBuffer()))
    },
    catch: unavailable,
  })

/** A stored PNG's pixels: none when it is gone, or is not a PNG. */
export const readPixels = (parts: Parts, key: string) =>
  readObject(parts, key).pipe(
    Effect.map(
      Option.flatMap((bytes) => {
        try {
          return Option.some(decodePng(bytes))
        } catch {
          return Option.none<Rgba>()
        }
      }),
    ),
  )

export const writeObject = (parts: Parts, key: string, bytes: Uint8Array, contentType: string) =>
  Effect.tryPromise({
    try: () => parts.bindings.bucket.put(key, bytes, { httpMetadata: { contentType } }),
    catch: unavailable,
  }).pipe(Effect.asVoid)

/** Where a piece's clean picture lives: a new name for each drawing, so a cached old one is never served. */
export const pictureKey = (accountId: string, pieceId: string, version: number) =>
  `${piecePrefix(accountId, pieceId)}clean-${version}.png`

/** Where a piece's turn keeps its files: its two anchor frames, its video and its frame sheet. */
export const turnKey = (
  accountId: string,
  pieceId: string,
  name: 'front.png' | 'side.png' | 'turn.mp4' | 'sheet.png',
) => `${piecePrefix(accountId, pieceId)}turn-${name}`

/** Tell the queue a piece's turn has a step waiting, now or after `delaySeconds` (polling the video model). */
export const enqueueTurn = (parts: Parts, pieceId: string, delaySeconds?: number) =>
  Effect.tryPromise({
    try: () =>
      parts.bindings.queue.send({ turnOf: pieceId }, delaySeconds === undefined ? undefined : { delaySeconds }),
    catch: unavailable,
  }).pipe(Effect.asVoid)

/** Tell the queue a piece's clean picture is waiting to be drawn. */
export const enqueuePicture = (parts: Parts, pieceId: string) =>
  Effect.tryPromise({ try: () => parts.bindings.queue.send({ cleanPictureOf: pieceId }), catch: unavailable }).pipe(
    Effect.asVoid,
  )

/** Tell the queue a capture is ready to process. */
export const enqueueCapture = (parts: Parts, captureId: string) =>
  Effect.tryPromise({ try: () => parts.bindings.queue.send({ captureId }), catch: unavailable }).pipe(Effect.asVoid)

export const storedAs = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.mapError(effect, unavailable)

/** The Wallet operation holding a capture's credits. Captures made before holds were recorded on the row
 * hold under `capture/<id>`. */
export const holdOf = (capture: { readonly id: string; readonly hold: string | null }) =>
  capture.hold ?? `capture/${capture.id}`
