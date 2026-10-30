import type { CapturePolicy } from './Policy.ts'
import type { Comparison, Judgement, TurnComparison } from './Providers.ts'

type PicturePolicy = CapturePolicy['pictures']

/** What happens to a kept cut-out: it stays the piece's picture (already clean, or a face shows and nothing is sent
 * on), a clean picture is drawn from it, or the person is asked for a retake (too little of the garment: every image
 * model invents a different garment from a fragment, 30 October). */
export const planFor = (
  judgement: Judgement,
  policy: PicturePolicy,
): { readonly plan: 'kept-real' | 'draw' | 'retake'; readonly reason?: 'face' } => {
  if (judgement.face >= policy.face) return { plan: 'kept-real', reason: 'face' }
  if (judgement.verdict === 'ready') return { plan: 'kept-real' }
  return judgement.verdict === 'fragment' ? { plan: 'retake' } : { plan: 'draw' }
}

/** Where a drawn picture goes, by how like the real cut-out it is (the weaker of the two answers): shown, offered
 * for the person to choose, or dropped. */
export const gateFor = (comparison: Comparison, policy: PicturePolicy): 'ready' | 'proposed' | 'rejected' => {
  const likeness = Math.min(comparison.same, comparison.faithful)
  if (likeness >= policy.show) return 'ready'
  return likeness < policy.reject ? 'rejected' : 'proposed'
}

/** Whether a turn is kept, from its checked frames beside the clean picture: every frame keeps the colour, and keeps
 * the logo or print when the garment has one (most frames see one). A plain garment has no print to keep: on the
 * preview, plain navy trousers turned faithfully were answered 0.06 for print (30 October). */
export const turnKept = (frames: ReadonlyArray<TurnComparison>, policy: CapturePolicy['turns']) => {
  const printed = frames.filter((frame) => frame.printed >= 0.5).length > frames.length / 2
  return frames.every((frame) => frame.colour >= policy.colour && (!printed || frame.print >= policy.print))
}
