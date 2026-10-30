import type { CapturePolicy } from './Policy.ts'
import type { Comparison, Judgement } from './Providers.ts'

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
