import { Effect } from 'effect'
import { Looks } from '../../src/looks/Looks.ts'

const notUsed = () => Effect.die('not used by these tests')

/** Looks that lists none: tests that are not about looks. */
export const noLooks = Looks.of({
  createLook: notUsed,
  listLooks: () => Effect.succeed([]),
  pieceLooks: () => Effect.succeed([]),
  getLook: notUsed,
  shareLook: notUsed,
  deleteLook: notUsed,
  looksById: notUsed,
})
