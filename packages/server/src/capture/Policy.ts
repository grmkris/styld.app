import { Context } from 'effect'

/** How captures are processed, from the Worker's configuration. One provider per job kind: changing
 * `single` on the preview and comparing keep rates is the experiment. */
export interface CapturePolicy {
  /** `off` keeps every photo as one detection with its original image: outages and native tests. */
  readonly providers: 'live' | 'off'
  /** Who cuts out a photo of one garment. Several garments, or an unsure answer, always go to SAM. */
  readonly single: 'cloudflare' | 'sam'
  /** How sure the decision model must be before a photo counts as one garment, or none. */
  readonly routeConfidence: number
  /** How a SAM mask becomes a cut-out's edge: `refined` snaps it to the photo's own edges (`Matte.ts`);
   * `stepped` scales it by nearest pixel, as before, for comparing the two on the preview. */
  readonly edges: 'refined' | 'stepped'
  /** How sure it must be that a garment is held up before the camera shoots. */
  readonly heldConfidence: number
  /** How sure it must be that a shot shows the same garment as the last one (its back). */
  readonly samePieceConfidence: number
  readonly dailyAllowance: number
  /** A photo's price, a video's for each started half-minute of it (about 10 a minute), and a redrawn clean picture's
   * (owner, 30 October: the first drawing is free). */
  readonly credits: { readonly photo: number; readonly videoHalfMinute: number; readonly redraw: number }
  /** Clean pictures drawn from kept cut-outs (owner, 30 October): who draws them (`off` keeps every real photo), and
   * the decision model's bars. A drawing at least `show` like the cut-out is shown; below `reject` it is dropped;
   * between, the person chooses. A cut-out at least `face` likely to show a face is never sent on. */
  readonly pictures: {
    readonly generator: 'muse' | 'off'
    readonly show: number
    readonly reject: number
    readonly face: number
  }
}

export class CaptureConfig extends Context.Service<CaptureConfig, CapturePolicy>()('@styld/server/CaptureConfig') {}

const choice = <A extends string>(value: unknown, allowed: ReadonlyArray<A>, fallback: A): A =>
  allowed.find((candidate) => candidate === value) ?? fallback

const number = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

/** The policy from the Worker's environment, with the run's defaults where a value is missing. */
export const capturePolicy = (env: Readonly<Record<string, unknown>>): CapturePolicy => ({
  providers: choice(env['STYLD_PROVIDERS'], ['live', 'off'], 'off'),
  single: choice(env['CUTOUT_SINGLE'], ['cloudflare', 'sam'], 'cloudflare'),
  routeConfidence: number(env['CUTOUT_ROUTE_CONFIDENCE'], 0.75),
  edges: choice(env['CUTOUT_EDGES'], ['refined', 'stepped'], 'refined'),
  heldConfidence: number(env['CAMERA_HELD_CONFIDENCE'], 0.6),
  samePieceConfidence: number(env['CAMERA_SAME_PIECE_CONFIDENCE'], 0.6),
  dailyAllowance: number(env['DAILY_ALLOWANCE'], 100),
  credits: { photo: 1, videoHalfMinute: 5, redraw: 1 },
  pictures: {
    generator: choice(env['CLEAN_PICTURES'], ['muse', 'off'], 'off'),
    show: number(env['CLEAN_PICTURE_SHOW'], 0.8),
    reject: number(env['CLEAN_PICTURE_REJECT'], 0.5),
    face: 0.3,
  },
})
