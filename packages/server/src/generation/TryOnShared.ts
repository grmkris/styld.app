import { Effect, Option } from 'effect'
import type { Boards } from '../boards/Boards.ts'
import type { PictureWork } from '../capture/Providers.ts'
import type { Media } from '../kernel/Media.ts'
import type { Pacing } from '../kernel/Pacing.ts'
import type { SignedMedia } from '../kernel/SignedMedia.ts'
import { photoPrefix } from '../photos/Finding.ts'
import type { PhotoStore } from '../photos/Store.ts'
import { Holds, holdId } from '../usage/Holds.ts'
import type { WardrobeStore } from '../wardrobe/Store.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { GenerationQueue } from './Queue.ts'
import type { TryOnPainter } from './TryOnPainter.ts'
import type { TryOnRow, TryOnStore } from './TryOnStore.ts'
import { tryOnEnding } from './TryOnLifecycle.ts'
import { called } from '../kernel/Bindings.ts'

// What the try-on operations share: the services they act through, a try-on's hold, where its result is kept, its
// queue message, how its status settles its credits, and the one privacy rule that lets a photo leave Styld.

/** The services every try-on operation acts through, provided once by the `TryOns` layer. */
export type TryOnServices =
  | TryOnStore
  | GenerationQueue
  | Holds
  | Pacing
  | TryOnPainter
  | PictureWork
  | Media
  | SignedMedia
  | PhotoStore
  | WardrobeStore
  | Wardrobe
  | Boards

/** A try-on's credits in the Wallet: one hold per try-on, its first and only attempt. */
export const tryOnHold = (tryOnId: string) => holdId('tryOn', tryOnId, 0)

/** Where a try-on's result is kept: under its photo's prefix, so deleting the photo deletes it. */
export const tryOnKey = (row: Pick<TryOnRow, 'accountId' | 'photoId' | 'id'>) =>
  `${photoPrefix(row.accountId, row.photoId)}try-ons/${row.id}.png`

/** Admission and drawing must finish well before the settlement sweep refunds a lost hold. */
export const tryOnLifetimeMillis = 30 * 60 * 1000

/** A claimed drawing older than Muse's 90 s deadline, plus storing it, belongs to a delivery that died. */
export const drawingPatienceMillis = 3 * 60 * 1000

/** The privacy exception (owner, 31 October 2026; ROADMAP › Privacy exception): an original photo goes to the image
 * model only for a try-on of the person's own My Gallery photo. The person said it shows them when they started it:
 * the contract takes no try-on without `thisIsMe` (`StartTryOn`), so every row is one they confirmed. Every other
 * photo stays in Styld. */
export const sendable = (photo: { readonly accountId: string }, tryOn: Pick<TryOnRow, 'accountId'>): boolean =>
  photo.accountId === tryOn.accountId

/** Hand a try-on to the generation queue. */
export const sendTryOn = (tryOnId: string) =>
  Effect.flatMap(GenerationQueue, (queue) => called(() => queue.send({ _tag: 'TakeTryOn', tryOnId }))).pipe(
    Effect.asVoid,
  )

/** Settle a try-on's credits by how it ended; the first settlement stands, so a later delivery may settle again. */
export const settleTryOn = (row: Pick<TryOnRow, 'id' | 'accountId' | 'status'>) =>
  Option.match(tryOnEnding(row.status), {
    onNone: () => Effect.void,
    onSome: (ending) => Effect.flatMap(Holds, (holds) => holds.settle(row.accountId, tryOnHold(row.id), ending)),
  })
