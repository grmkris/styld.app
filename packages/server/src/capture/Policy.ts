import { Context, Layer } from 'effect'

/** How captures are processed: the decision model's bars, each a constant of this module (changing one is a commit).
 * Single garments are cut out by Cloudflare, several by SAM, and every SAM mask's edge is refined against the photo
 * (`Matte.ts`). */
export interface CapturePolicy {
  /** `off` keeps every photo as one detection with its original image. Only the native test composition sets it,
   * until the garment pipeline gets fakes of its own (C4a); the Worker always runs `live`. */
  readonly providers: 'live' | 'off'
  /** How sure the decision model must be before a photo counts as one garment, or none. */
  readonly routeConfidence: number
  /** How sure it must be that a garment is held up before the camera shoots. */
  readonly heldConfidence: number
  /** How sure it must be that a shot shows the same garment as the last one (its back). */
  readonly samePieceConfidence: number
  /** Clean pictures drawn from kept cut-outs (owner, 30 October): a drawing at least `show` like the cut-out is shown;
   * below `reject` it is dropped; between, the person chooses. A cut-out at least `face` likely to show a face is
   * never sent on. */
  readonly pictures: {
    readonly show: number
    readonly reject: number
    readonly face: number
  }
  /** How a garment seen more than once becomes one card (2026-10-31): Clef's answer to "the same garment?" at or
   * above `same` joins a sighting to another of the import, or takes it for a piece already in the wardrobe. A
   * sighting is compared with at most `sightings` others of its kind and `pieces` of the wardrobe's. On the
   * person-routing spike's two real videos, 0.8 halved the cards with no false merge (30 October). */
  readonly matching: {
    readonly same: number
    readonly sightings: number
    readonly pieces: number
  }
  /** The floors every checked frame of a turn must reach, beside the clean picture, for the turn to be kept: colour
   * and logo or print (the 30 October comparison's gate, which every good take passed and the drifting models
   * failed). */
  readonly turns: {
    readonly colour: number
    readonly print: number
  }
}

/** The policy the Worker runs. */
export const capturePolicy: CapturePolicy = {
  providers: 'live',
  routeConfidence: 0.75,
  heldConfidence: 0.6,
  samePieceConfidence: 0.6,
  pictures: { show: 0.8, reject: 0.5, face: 0.3 },
  matching: { same: 0.8, sightings: 10, pieces: 6 },
  turns: { colour: 0.8, print: 0.6 },
}

export class CaptureConfig extends Context.Service<CaptureConfig, CapturePolicy>()('@styld/server/CaptureConfig') {
  static readonly layer = Layer.succeed(this, capturePolicy)
}
