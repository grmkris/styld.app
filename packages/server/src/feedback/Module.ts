import { Effect } from 'effect'
import { module } from '../kernel/Module.ts'
import { Feedback } from './Feedback.ts'

/** What assistants tell Styld about Styld: the notes they send (`feedback_send`), which admins read and mark handled
 * through the admin tools, kept 180 days. */
export const feedback = module({
  layer: Feedback.layer,
  sweeps: [{ name: 'feedback', run: Effect.flatMap(Feedback, (notes) => notes.sweep()) }],
})
