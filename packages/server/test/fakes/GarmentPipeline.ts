import { Effect, Layer } from 'effect'
import { Garments } from '../../src/capture/Garments.ts'
import {
  GarmentSegmenter,
  GarmentVision,
  PictureWork,
  type Route,
  type Suggestion,
  type WorkingCopies,
} from '../../src/capture/Providers.ts'

// The garment pipeline over scripted providers: its working copies, a route, one suggestion for every cut, and SAM's
// masks by prompt. Anything else a test does not expect to be asked dies.

const unused = () => Effect.die('not asked')

export interface Scripted {
  readonly copies: WorkingCopies
  readonly suggestion: Suggestion
  readonly still: GarmentSegmenter['Service']['still']
  readonly route?: Route
}

/** The real `Garments` layer over the scripted providers. */
export const scriptedGarments = ({ copies, suggestion, still, route }: Scripted) =>
  Garments.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          PictureWork,
          PictureWork.of({
            workingCopies: () => Effect.succeed(copies),
            foreground: unused,
            thumbnail: unused,
            jpeg: unused,
          }),
        ),
        Layer.succeed(
          GarmentVision,
          GarmentVision.of({
            route: route === undefined ? unused : () => Effect.succeed(route),
            suggest: () => Effect.succeed(suggestion),
            checkHeld: unused,
            judge: unused,
            compare: unused,
            sameGarment: unused,
            compareTurn: unused,
          }),
        ),
        Layer.succeed(
          GarmentSegmenter,
          GarmentSegmenter.of({ still, upload: unused, track: unused, forget: () => Effect.void }),
        ),
      ),
    ),
  )
