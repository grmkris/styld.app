import { Effect } from 'effect'
import type { Tastes } from '../../src/taste/Taste.ts'

const notUsed = () => Effect.die('not used by these tests')

/** Every taste operation, none of them used: tests spread it and replace the operations they are about. */
export const unusedTastes: Tastes['Service'] = {
  getTaste: notUsed,
  setOccasions: notUsed,
  addStyleNote: notUsed,
  deleteStyleNote: notUsed,
  finishFirstRun: notUsed,
}
