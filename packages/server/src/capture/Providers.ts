import type { Category, Colour, Subcategory } from '@styld/protocol'
import { Context, type Effect, type Option, Schema } from 'effect'
import type { Found } from './SamStream.ts'

/** A picture handed to a provider: Styld's own re-encoded copy, never the person's original file. */
export interface Picture {
  readonly bytes: Uint8Array
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** A provider refused or failed before it accepted the work. `retryable` failures go back to the queue. */
export class ProviderFailed extends Schema.TaggedError<ProviderFailed>()('ProviderFailed', {
  provider: Schema.String,
  retryable: Schema.Boolean,
}) {}

/** A provider accepted paid work and then its answer was lost. Calling again could pay twice, so the
 * capture waits for the person instead of retrying on its own. */
export class ProviderOutcomeUnknown extends Schema.TaggedError<ProviderOutcomeUnknown>()('ProviderOutcomeUnknown', {
  provider: Schema.String,
}) {}

/** How many garments a photo shows, as the decision model judged it. */
export interface Route {
  readonly garments: 'none' | 'one' | 'several'
  readonly confidence: number
}

/** What the decision model suggests for one cut-out piece. */
export interface Suggestion {
  readonly category: Category | undefined
  readonly confidence: number
  readonly subcategory: Subcategory | undefined
  readonly colours: ReadonlyArray<Colour>
  /** How likely the piece is one whole garment, shown completely, rather than part of one, several, or not
   * clothing (0–1). */
  readonly whole: number
}

/** The camera's question: is one garment being held up, which side shows, is it the last one again? */
export interface HeldCheck {
  readonly held: number
  readonly side: 'front' | 'back' | 'unclear'
  readonly samePrevious: number
}

/** Cloudflare Clef-flash: typed questions about a picture, each answered with probabilities. */
export class GarmentVision extends Context.Service<
  GarmentVision,
  {
    readonly route: (picture: Picture) => Effect.Effect<Route, ProviderFailed>
    readonly suggest: (picture: Picture) => Effect.Effect<Suggestion, ProviderFailed>
    readonly checkHeld: (picture: Picture, previous: Option.Option<Picture>) => Effect.Effect<HeldCheck, ProviderFailed>
  }
>()('@styld/server/GarmentVision') {}

/** Styld's working copies of a photo: re-encoded (orientation applied, metadata gone), at most 2048 px.
 * `png` and `jpeg` have the same size, so masks found on one apply to the other. */
export interface WorkingCopies {
  readonly width: number
  readonly height: number
  readonly png: Uint8Array
  readonly jpeg: Uint8Array
  /** At most 768 px, for the decision model. */
  readonly small: Uint8Array
}

/** Cloudflare Images: re-encoding, and background removal for a photo of one garment. */
export class PictureWork extends Context.Service<
  PictureWork,
  {
    readonly workingCopies: (original: Uint8Array) => Effect.Effect<WorkingCopies, ProviderFailed>
    /** The working copy with everything but the foreground transparent, as a PNG of the same size. */
    readonly foreground: (original: Uint8Array) => Effect.Effect<Uint8Array, ProviderFailed>
    /** A small WebP of a stored image, for assistant views. */
    readonly thumbnail: (image: Uint8Array, width: number) => Effect.Effect<Uint8Array, ProviderFailed>
  }
>()('@styld/server/PictureWork') {}

/** A video SAM should track, already stored in Styld's bucket. Its metadata boxes (where a phone keeps
 * the place it was recorded) are blanked on the way to Meta. */
export interface StoredVideo {
  readonly key: string
  readonly bytes: number
  readonly contentType: 'video/mp4' | 'video/quicktime'
  readonly metadata: ReadonlyArray<{ readonly start: number; readonly end: number }>
}

/** Meta SAM 3.1: every instance of a concept, with a mask per instance (and per frame, for a video). */
export class GarmentSegmenter extends Context.Service<
  GarmentSegmenter,
  {
    readonly still: (
      picture: Picture,
      prompt: string,
    ) => Effect.Effect<ReadonlyArray<Found>, ProviderFailed | ProviderOutcomeUnknown>
    /** Upload a stored video to Meta and return its file id; uploading again is safe. */
    readonly upload: (video: StoredVideo) => Effect.Effect<string, ProviderFailed>
    /** Track `prompt` through an uploaded video, keeping only the masks of `frames`. */
    readonly track: (
      fileId: string,
      prompt: string,
      frames: ReadonlySet<number>,
    ) => Effect.Effect<
      {
        readonly found: ReadonlyArray<Found>
        readonly framesBilled: number
        /** The frame size SAM saw, which the masks' coordinates are in. */
        readonly frameSize: { readonly width: number; readonly height: number } | undefined
      },
      ProviderFailed | ProviderOutcomeUnknown
    >
    /** Delete an uploaded video at Meta once it is tracked; a failure is logged, never raised. */
    readonly forget: (fileId: string) => Effect.Effect<void>
  }
>()('@styld/server/GarmentSegmenter') {}
