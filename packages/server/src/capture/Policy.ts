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
  /** How sure it must be that a garment is held up before the camera shoots. */
  readonly heldConfidence: number
  readonly dailyAllowance: number
  readonly credits: { readonly photo: number; readonly video: number }
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
  heldConfidence: number(env['CAMERA_HELD_CONFIDENCE'], 0.7),
  dailyAllowance: number(env['DAILY_ALLOWANCE'], 100),
  credits: { photo: 1, video: 10 },
})
