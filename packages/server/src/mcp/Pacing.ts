import { Context, Effect } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { ToolError } from './Tools.ts'

/** The same per-account limits the website's endpoints keep, for what an assistant asks: fetching from the web (a
 * product page or a photo's address) and generating pictures. */
export class Pacing extends Context.Service<
  Pacing,
  {
    readonly link: (accountId: string) => Effect.Effect<boolean>
    readonly generate: (accountId: string) => Effect.Effect<boolean>
  }
>()('@styld/server/Pacing') {}

const slowDown = new ToolError({
  code: 'slow_down',
  message: 'Too many of these in a minute.',
  recovery: 'Wait a minute, then try again.',
  retryable: true,
})

/** Go on only at the account's pace. */
export const paced =
  (which: 'link' | 'generate') =>
  <A, R>(effect: Effect.Effect<A, ToolError, R>) =>
    Effect.gen(function* () {
      const { accountId } = yield* CurrentAccount
      if (!(yield* (yield* Pacing)[which](accountId))) return yield* slowDown
      return yield* effect
    })
