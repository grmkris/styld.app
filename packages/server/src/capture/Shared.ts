import type { SignedMedia } from '../kernel/SignedMedia.ts'
import type { PaidAttempts } from '../usage/Attempts.ts'
import { type Ending, type Holds, holdId } from '../usage/Holds.ts'
import type { Pacing } from '../kernel/Pacing.ts'
import type { Garments } from './Garments.ts'
import type { CaptureMetrics } from '../kernel/Metrics.ts'
import type { GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './Providers.ts'
import { readPng } from '@styld/imaging'
import { Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { deleteAfterRows, keysUnder, Media } from '../kernel/Media.ts'
import { accountPrefix, piecePrefix } from '../wardrobe/Media.ts'
import { PieceQueue } from '../wardrobe/Processing.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import type { CaptureRow, CaptureStore } from './Store.ts'
import type { PieceChanged } from '../safety/PieceChanged.ts'

// What capture's operations share: the services they act through, where a capture's objects live, reading and writing
// them, the piece queue's messages, and how a capture's status ends its hold. Every operation yields the services it
// uses; the `Captures` layer provides them once (`Service.ts`).

/** The services capture's operations act through, provided once by the `Captures` layer. */
export type CaptureServices =
  | CaptureStore
  | WardrobeStore
  | Media
  | SignedMedia
  | PieceQueue
  | GarmentVision
  | PictureWork
  | ImageGenerator
  | VideoGenerator
  | Garments
  | Holds
  | PaidAttempts
  | Pacing
  | CaptureMetrics
  | PieceChanged

export const unavailable = () => Unavailable.make({})

/** Where a capture's own objects live, under the account's prefix so deletion sweeps them. */
export const captureKey = (accountId: string, captureId: string, name: string) =>
  `${accountPrefix(accountId)}captures/${captureId}/${name}`

/** A stored object's bytes, or none when it is gone. */
export const readObject = Effect.fnUntraced(function* (key: string) {
  const { bucket } = yield* Media
  return yield* Effect.tryPromise({
    try: async () => {
      const object = await bucket.get(key)
      return object === null ? Option.none<Uint8Array>() : Option.some(new Uint8Array(await object.arrayBuffer()))
    },
    catch: unavailable,
  })
})

/** A stored PNG's pixels: none when it is gone, or is not a PNG. */
export const readPixels = (key: string) => readObject(key).pipe(Effect.map(Option.flatMap(readPng)))

export const writeObject = Effect.fnUntraced(function* (key: string, bytes: Uint8Array, contentType: string) {
  const { bucket } = yield* Media
  yield* Effect.tryPromise({
    try: () => bucket.put(key, bytes, { httpMetadata: { contentType } }),
    catch: unavailable,
  })
})

/** The objects of a capture whose rows were deleted or decided: everything under its own folder, its photo or video
 * and its stills, except what a piece or an open tray card still shows (`keysInUse`). Rows first, then objects; a
 * failed listing or delete is logged, its bytes left under the account's prefix for account deletion. */
export const forgetCaptureObjects = (
  capture: Pick<CaptureRow, 'id' | 'accountId' | 'originalKey'>,
  frames: ReadonlyArray<{ readonly objectKey: string }>,
) =>
  Effect.gen(function* () {
    const { bucket } = yield* Media
    const listed = yield* keysUnder(bucket, captureKey(capture.accountId, capture.id, ''))
    const candidates = [...new Set([...listed, capture.originalKey, ...frames.map(({ objectKey }) => objectKey)])]
    const inUse = yield* storedAs((yield* WardrobeStore).keysInUse(capture.accountId, candidates))
    yield* deleteAfterRows(
      bucket,
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

/** Send the piece queue a message, now or after `delaySeconds`. */
const enqueue = (message: Parameters<PieceQueue['Service']['send']>[0], delaySeconds?: number) =>
  Effect.flatMap(PieceQueue, (queue) =>
    Effect.tryPromise({
      try: () => queue.send(message, delaySeconds === undefined ? undefined : { delaySeconds }),
      catch: unavailable,
    }),
  ).pipe(Effect.asVoid)

/** Tell the queue a piece's turn has a step waiting, now or after `delaySeconds` (polling the video model). */
export const enqueueTurn = (pieceId: string, delaySeconds?: number) =>
  enqueue({ _tag: 'MakeTurn', pieceId }, delaySeconds)

/** Tell the queue a piece's clean picture is waiting to be drawn. */
export const enqueuePicture = (pieceId: string) => enqueue({ _tag: 'DrawPicture', pieceId })

/** Tell the queue a capture's sightings wait to be compared, now or after `delaySeconds` (another delivery has the
 * import's next one). */
export const enqueueMatch = (captureId: string, delaySeconds?: number) =>
  enqueue({ _tag: 'MatchCapture', captureId }, delaySeconds)

/** Tell the queue a capture is ready to process. */
export const enqueueCapture = (captureId: string) => enqueue({ _tag: 'ProcessCapture', captureId })

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
