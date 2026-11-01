import { type Ending, Holds, holdId } from '../usage/Holds.ts'
import { Garments } from './Garments.ts'
import { CaptureMetrics } from './Metrics.ts'
import { GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './Providers.ts'
import { readPng } from '@styld/imaging'
import { Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { deleteAfterRows, keysUnder } from '../kernel/Media.ts'
import { accountPrefix, piecePrefix } from '../wardrobe/Media.ts'
import type { WorkMessage } from '../wardrobe/Processing.ts'
import { makeStore } from '../wardrobe/Store.ts'
import type { WardrobeBindings } from '../wardrobe/Parts.ts'
import { type CaptureRow, makeCaptureStore } from './Store.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'

/** The Cloudflare bindings captures read and write. */
export interface CaptureBindings {
  readonly database: WardrobeBindings['database']
  readonly bucket: WardrobeBindings['bucket']
  readonly queue: { send(message: WorkMessage, options?: { readonly delaySeconds?: number }): Promise<unknown> }
}

export const unavailable = () => Unavailable.make({})

/** What every capture operation shares: bindings, stores and the providers, credits and call counter it was built
 * with, so no operation asks its caller for them. */
export const makeParts = (bindings: CaptureBindings) =>
  Effect.gen(function* () {
    return {
      bindings,
      vision: yield* GarmentVision,
      work: yield* PictureWork,
      generator: yield* ImageGenerator,
      videos: yield* VideoGenerator,
      garments: yield* Garments,
      holds: yield* Holds,
      metrics: yield* CaptureMetrics,
      pieceChanged: yield* PieceChanged,
      store: makeCaptureStore(bindings.database),
      wardrobeStore: makeStore(bindings.database),
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
  readObject(parts, key).pipe(Effect.map(Option.flatMap(readPng)))

export const writeObject = (parts: Parts, key: string, bytes: Uint8Array, contentType: string) =>
  Effect.tryPromise({
    try: () => parts.bindings.bucket.put(key, bytes, { httpMetadata: { contentType } }),
    catch: unavailable,
  }).pipe(Effect.asVoid)

/** The objects of a capture whose rows were deleted or decided: everything under its own folder, its photo or video
 * and its stills, except what a piece or an open tray card still shows (`keysInUse`). Rows first, then objects; a
 * failed listing or delete is logged, its bytes left under the account's prefix for account deletion. */
export const forgetCaptureObjects = (
  parts: Parts,
  capture: Pick<CaptureRow, 'id' | 'accountId' | 'originalKey'>,
  frames: ReadonlyArray<{ readonly objectKey: string }>,
) =>
  Effect.gen(function* () {
    const listed = yield* keysUnder(parts.bindings.bucket, captureKey(capture.accountId, capture.id, ''))
    const candidates = [...new Set([...listed, capture.originalKey, ...frames.map(({ objectKey }) => objectKey)])]
    const inUse = yield* storedAs(parts.wardrobeStore.keysInUse(capture.accountId, candidates))
    yield* deleteAfterRows(
      parts.bindings.bucket,
      candidates.filter((key) => !inUse.has(key)),
      'capture',
    )
  }).pipe(Effect.ignore({ log: true, message: 'Styld.Capture could not forget stored objects' }))

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
      parts.bindings.queue.send(
        { _tag: 'MakeTurn', pieceId },
        delaySeconds === undefined ? undefined : { delaySeconds },
      ),
    catch: unavailable,
  }).pipe(Effect.asVoid)

/** Tell the queue a piece's clean picture is waiting to be drawn. */
export const enqueuePicture = (parts: Parts, pieceId: string) =>
  Effect.tryPromise({
    try: () => parts.bindings.queue.send({ _tag: 'DrawPicture', pieceId }),
    catch: unavailable,
  }).pipe(Effect.asVoid)

/** Tell the queue a capture's sightings wait to be compared, now or after `delaySeconds` (another delivery has the
 * import's next one). */
export const enqueueMatch = (parts: Parts, captureId: string, delaySeconds?: number) =>
  Effect.tryPromise({
    try: () =>
      parts.bindings.queue.send(
        { _tag: 'MatchCapture', captureId },
        delaySeconds === undefined ? undefined : { delaySeconds },
      ),
    catch: unavailable,
  }).pipe(Effect.asVoid)

/** Tell the queue a capture is ready to process. */
export const enqueueCapture = (parts: Parts, captureId: string) =>
  Effect.tryPromise({
    try: () => parts.bindings.queue.send({ _tag: 'ProcessCapture', captureId }),
    catch: unavailable,
  }).pipe(Effect.asVoid)

export const storedAs = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.mapError(effect, unavailable)

/** How a capture's status ended its hold, once it ended: in the tray or done it succeeded. A capture still
 * processing has not ended. */
export const endingOf = (status: CaptureRow['status']): Option.Option<Ending> => {
  switch (status) {
    case 'review':
    case 'done':
      return Option.some('succeeded')
    case 'failed':
      return Option.some('failed')
    case 'unknown':
      return Option.some('unknown')
    case 'processing':
      return Option.none()
  }
}

/** The hold paying for a capture's latest attempt: each retry the person asks for holds its credits again. */
export const captureHold = (capture: { readonly id: string; readonly attempt: number }) =>
  holdId('capture', capture.id, capture.attempt)
