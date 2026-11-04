import { CurrentAccount, SlowDown } from '@styld/protocol'
import { Context, Effect, Layer } from 'effect'
import type * as Headers from 'effect/http/Headers'
import type { PaceName } from './Paces.ts'

// The paces' table is `Paces.ts`, which the Worker's entry declares at startup without this module's imports.

/** A Workers RateLimit binding's runtime object. */
export interface Limiter {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>
}

/** The visitor's network, the key of a network pace. A Worker has no socket peer, so it is the address Cloudflare
 * sets in `cf-connecting-ip` (absent only under local tooling, where every request shares one key). */
export const networkOf = (headers: Headers.Headers) => headers['cf-connecting-ip'] ?? 'unknown'

/** Each pace by its key. A limiter that fails refuses: a limit is never worth an outage or an open door. */
export class Pacing extends Context.Service<
  Pacing,
  {
    /** Whether `key` may go on within `pace`, counting this time. */
    readonly allows: (pace: PaceName, key: string) => Effect.Effect<boolean>
    /** Go on within the current account's pace, else `SlowDown`. */
    readonly account: (pace: PaceName) => Effect.Effect<void, SlowDown, CurrentAccount>
  }
>()('@styld/server/kernel/Pacing') {
  /** The paces over their bindings' runtime objects. */
  static readonly layer = (limiters: { readonly [Name in PaceName]: Limiter }) => {
    const allows = (pace: PaceName, key: string) =>
      Effect.tryPromise(() => limiters[pace].limit({ key })).pipe(
        Effect.map(({ success }) => success),
        Effect.orElseSucceed(() => false),
      )
    return Layer.succeed(
      Pacing,
      Pacing.of({
        allows,
        account: Effect.fn('Styld.Pacing.account')(function* (pace) {
          const { accountId } = yield* CurrentAccount
          if (!(yield* allows(pace, accountId))) return yield* SlowDown.make({})
        }),
      }),
    )
  }
}
