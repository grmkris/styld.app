import type { ProviderError } from '../providers/Errors.ts'
import type { Colour, Occasion, Pattern, PieceType, Season } from '@styld/protocol'
import { Context, type Effect, type Option } from 'effect'
import type { Found } from '../providers/SamStream.ts'

/** A picture handed to a provider: Styld's own re-encoded copy, never the person's original file. */
export interface Picture {
  readonly bytes: Uint8Array
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** How a photo shows the clothes: held up, laid out on a bed, table or floor, on hangers, worn, or none of these (a
 * product photo). */
export type Scene = 'held' | 'flat' | 'hanging' | 'worn' | 'other'

/** How many garments a photo shows, as the decision model judged it. */
export interface Route {
  readonly garments: 'none' | 'one' | 'several'
  readonly confidence: number
  /** How likely any part of a person shows (0–1): someone wearing or holding the clothes, or only a hand. */
  readonly person: number
  /** The scene, when the decision model is fairly sure of it. */
  readonly scene?: Scene
}

/** What the decision model suggests for one cut-out piece. */
export interface Suggestion {
  readonly type: PieceType | undefined
  /** How sure the model is of the kind of thing it is: the share of its answer on the type's group. */
  readonly confidence: number
  readonly colours: ReadonlyArray<Colour>
  /** The seasons it is worn in, none for all year; made for rain (T-12). */
  readonly seasons: ReadonlyArray<Season>
  readonly rainproof: boolean
  readonly occasions: ReadonlyArray<Occasion>
  readonly pattern: Pattern | undefined
  /** How likely the piece is one whole garment, shown completely, rather than part of one, several, or not
   * clothing (0–1). */
  readonly whole: number
}

/** The camera's question: is one garment shown, which side, is it the last one again, does a person hold it? */
export interface HeldCheck {
  readonly held: number
  readonly side: 'front' | 'back' | 'unclear'
  readonly samePrevious: number
  readonly holding: number
}

/** How good a kept cut-out is as the piece's picture: already clean, whole but held or crumpled, missing parts, or
 * too little of the garment to draw from. */
export type Verdict = 'ready' | 'improve' | 'repair' | 'fragment'

/** The decision model's judgement of a kept cut-out, and how likely a face shows in it (0–1). */
export interface Judgement {
  readonly verdict: Verdict
  readonly confidence: number
  readonly face: number
}

/** Cloudflare Clef-flash: typed questions about a picture, each answered with probabilities. */
export class GarmentVision extends Context.Service<
  GarmentVision,
  {
    readonly route: (picture: Picture) => Effect.Effect<Route, ProviderError>
    readonly suggest: (picture: Picture) => Effect.Effect<Suggestion, ProviderError>
    readonly checkHeld: (
      picture: Picture,
      previous: Option.Option<Picture>,
      layout: 'held' | 'flat',
    ) => Effect.Effect<HeldCheck, ProviderError>
    readonly judge: (cutout: Picture) => Effect.Effect<Judgement, ProviderError>
    /** How likely two real pictures show the same garment (0–1): two sightings, or a sighting and a piece. */
    readonly sameGarment: (picture: Picture, other: Picture) => Effect.Effect<number, ProviderError>
    /** A frame of a turn beside the clean picture it ends on. */
    readonly compareTurn: (frame: Picture, front: Picture) => Effect.Effect<TurnComparison, ProviderError>
  }
>()('@styld/server/GarmentVision') {}

/** How a frame of a turn compares with the clean picture (0–1): the same garment, its colour, its logo or print, and
 * whether the clean picture shows a logo or print at all. */
export interface TurnComparison {
  readonly same: number
  readonly colour: number
  readonly print: number
  readonly printed: number
}

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
    readonly workingCopies: (original: Uint8Array) => Effect.Effect<WorkingCopies, ProviderError>
    /** The working copy with everything but the foreground transparent, as a PNG of the same size. */
    readonly foreground: (original: Uint8Array) => Effect.Effect<Uint8Array, ProviderError>
    /** A small WebP of a stored image, for assistant views. */
    readonly thumbnail: (image: Uint8Array, width: number) => Effect.Effect<Uint8Array, ProviderError>
    /** An opaque picture as a JPEG, for a provider that takes only small requests (the video model's frames). */
    readonly jpeg: (image: Uint8Array) => Effect.Effect<Uint8Array, ProviderError>
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
    readonly still: (picture: Picture, prompt: string) => Effect.Effect<ReadonlyArray<Found>, ProviderError>
    /** Upload a stored video to Meta and return its file id; uploading again is safe. */
    readonly upload: (video: StoredVideo) => Effect.Effect<string, ProviderError>
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
      ProviderError
    >
    /** Delete an uploaded video at Meta: succeeds once Meta deleted it or has no such file. */
    readonly forget: (fileId: string) => Effect.Effect<void, ProviderError>
  }
>()('@styld/server/GarmentSegmenter') {}

/** What a clean picture is drawn from: the front's cut-out, the back's when the camera took one, the colour to draw
 * it on, and the person's own words on a redraw. Cut-outs only: never a photo of a person. */
export interface DrawRequest {
  /** Which side of the garment the picture shows: its front, or its back (owner, 4 November: only from a real back). */
  readonly side: 'front' | 'back'
  /** The cut-out of that side, the picture is drawn from. */
  readonly subject: Picture
  /** The garment's other side, for reference only. */
  readonly other: Option.Option<Picture>
  readonly key: 'green' | 'magenta'
  readonly hint: Option.Option<string>
}

/** An image model that draws a clean product picture of a garment from its cut-out (Meta Muse Image by default),
 * named as each picture records it. A refusal it did not bill fails with `ProviderError`; an answer lost after it
 * took the work is unknown, so the picture is never drawn twice on its own. */
export class ImageGenerator extends Context.Service<
  ImageGenerator,
  {
    readonly provider: string
    readonly model: string
    readonly draw: (request: DrawRequest) => Effect.Effect<Picture, ProviderError>
    /** The front anchor of a turn (the clean picture on its hanger, on the key colour) as a strict side view. */
    readonly profile: (front: Picture, key: 'green' | 'magenta') => Effect.Effect<Picture, ProviderError>
  }
>()('@styld/server/ImageGenerator') {}

/** What a turn is made from: the side view as its first frame and the clean front as its last, on one key colour,
 * both 720 by 1280 with the hanger's apex in the same place. */
export interface TurnRequest {
  readonly side: Picture
  readonly front: Picture
  readonly key: 'green' | 'magenta'
}

/** Where a started turn stands: still being made, made (an MP4), or ended without a video. */
export type TurnStatus =
  | { readonly _tag: 'Pending' }
  | { readonly _tag: 'Done'; readonly video: { readonly bytes: Uint8Array; readonly contentType: 'video/mp4' } }
  | { readonly _tag: 'Failed' }

/** A video model that turns a clean picture on its hanger, from side view to front (Veo 3.1 Lite by default). Starting
 * is asynchronous: the job, an opaque value the provider returns, is kept and polled. */
export class VideoGenerator extends Context.Service<
  VideoGenerator,
  {
    readonly provider: string
    readonly model: string
    /** How often a turn being made is asked about (the native fake asks every second). */
    readonly pollSeconds: number
    readonly start: (request: TurnRequest) => Effect.Effect<unknown, ProviderError>
    readonly status: (operation: unknown) => Effect.Effect<TurnStatus, ProviderError>
  }
>()('@styld/server/VideoGenerator') {}
