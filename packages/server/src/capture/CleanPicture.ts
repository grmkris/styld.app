import type { CapturePolicy } from './Policy.ts'
import type { Comparison, Judgement, TurnComparison } from './Providers.ts'

type PicturePolicy = CapturePolicy['pictures']

/** What happens to a kept cut-out: a clean picture is drawn from it, even one already clean (owner, 2026-10-31: every
 * piece is drawn); it stays the piece's picture when a face may show, and nothing is sent on; or the person is asked
 * for a retake (too little of the garment: every image model invents a different garment from a fragment, 30
 * October). */
export const planFor = (
  judgement: Judgement,
  policy: PicturePolicy,
): { readonly plan: 'kept-real' | 'draw' | 'retake'; readonly reason?: 'face' } => {
  if (judgement.face >= policy.face) return { plan: 'kept-real', reason: 'face' }
  return judgement.verdict === 'fragment' ? { plan: 'retake' } : { plan: 'draw' }
}

/** Where a drawn picture goes, by how like the real cut-out it is (the weaker of the two answers): shown, or dropped
 * below the reject bar. */
export const gateFor = (comparison: Comparison, policy: PicturePolicy): 'ready' | 'rejected' =>
  Math.min(comparison.same, comparison.faithful) < policy.reject ? 'rejected' : 'ready'

/** Whether a turn is kept, from its checked frames beside the clean picture: every frame keeps the colour, and keeps
 * the logo or print when the garment has one (most frames see one). A plain garment has no print to keep: on the
 * preview, plain navy trousers turned faithfully were answered 0.06 for print (30 October). */
export const turnKept = (frames: ReadonlyArray<TurnComparison>, policy: CapturePolicy['turns']) => {
  const printed = frames.filter((frame) => frame.printed >= 0.5).length > frames.length / 2
  return frames.every((frame) => frame.colour >= policy.colour && (!printed || frame.print >= policy.print))
}
