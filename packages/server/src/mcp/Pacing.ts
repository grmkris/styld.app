import { CurrentAccount, SlowDown } from '@styld/protocol'
import { Context, Effect } from 'effect'

/** The same per-account limits the website's endpoints keep, for what an assistant asks: fetching from the web (a
 * product page or a photo's address) and generating pictures. */
export class Pacing extends Context.Service<
  Pacing,
  {
    readonly link: (accountId: string) => Effect.Effect<boolean>
    readonly generate: (accountId: string) => Effect.Effect<boolean>
  }
>()('@styld/server/Pacing') {}

/** Go on only at the account's pace. */
export const paced =
  (which: 'link' | 'generate') =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const { accountId } = yield* CurrentAccount
      if (!(yield* (yield* Pacing)[which](accountId))) return yield* SlowDown.make({})
      return yield* effect
    })
