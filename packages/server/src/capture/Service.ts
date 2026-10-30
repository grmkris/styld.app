import { Context, Effect } from 'effect'
import { creating, reading } from './Captures.ts'
import { retrying } from './Retrying.ts'
import { CaptureMetrics } from './Metrics.ts'
import { type CaptureBindings, makeParts } from './Parts.ts'
import { CaptureConfig } from './Policy.ts'
import { processing } from './Processing.ts'
import { picturing } from './Pictures.ts'
import { GarmentSegmenter, GarmentVision, ImageGenerator, PictureWork } from './Providers.ts'
import { detectionPictures, reviewing } from './Review.ts'
import { Usage } from './Usage.ts'

type Requirements =
  | GarmentVision
  | PictureWork
  | GarmentSegmenter
  | ImageGenerator
  | Usage
  | CaptureConfig
  | CaptureMetrics

/** Every capture operation, with the providers, metering and policy it was built with. Callers provide
 * only `CurrentAccount` (for a person's operations). */
const make = (bindings: CaptureBindings) =>
  Effect.gen(function* () {
    const parts = yield* makeParts(bindings)
    const services = yield* Effect.context<Requirements>()
    const bound =
      <Args extends ReadonlyArray<unknown>, A, E, R>(operation: (...args: Args) => Effect.Effect<A, E, R>) =>
      (...args: Args) =>
        Effect.provide(operation(...args), services)
    const operations = {
      ...creating(parts),
      ...reading(parts),
      ...retrying(parts),
      ...reviewing(parts),
      ...detectionPictures(parts),
      ...processing(parts),
      ...picturing(parts),
    }
    return {
      createCapture: bound(operations.createCapture),
      createVideoCapture: bound(operations.createVideoCapture),
      tray: bound(operations.tray),
      check: bound(operations.check),
      retry: bound(operations.retry),
      remove: bound(operations.remove),
      review: bound(operations.review),
      detectionPicture: bound(operations.detectionPicture),
      processCapture: bound(operations.processCapture),
      failCapture: bound(operations.failCapture),
      processPicture: bound(operations.processPicture),
      failPicture: bound(operations.failPicture),
    }
  })

export class Captures extends Context.Service<Captures, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Captures',
) {}

export const makeCaptures = make
