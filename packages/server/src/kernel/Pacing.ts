import * as Cloudflare from '@alchemy.run/cloudflare'
import { CurrentAccount, SlowDown } from '@styld/protocol'
import { Context, Effect, Layer, Record } from 'effect'
import type * as Headers from 'effect/http/Headers'
import { currentStage } from '../Resources.ts'

// Every pace Styld keeps, in one table: how many times a minute, and whom it counts. Each is a Workers RateLimit
// binding, shared by every isolate; its namespace is the deployment's (`Resources.ts`). Operations pace themselves
// (`Pacing.account`), so the website, the assistants and Styld's own tools are held to the same pace once.

/** A pace: its binding's name, its namespace's offset in the stage's block (`Resources.ts` `stages`), and how many a
 * minute each key may. */
interface Pace {
  readonly binding: string
  readonly namespace: number
  readonly perMinute: number
}

/** @internal Exported for its tests. */
export const paces = {
  // Network paces, keyed by the visitor's address (`networkOf`).
  /** The browser telemetry relay is unauthenticated; the SDK flushes about twice every 5 seconds per tab. */
  telemetry: { binding: 'TELEMETRY_RATE_LIMIT', namespace: 0, perMinute: 120 },
  /** Dynamic client registration is open to anyone. */
  registration: { binding: 'OAUTH_REGISTER_RATE_LIMIT', namespace: 1, perMinute: 10 },
  /** Sign-in codes are real mail from styld.app. */
  codeRequest: { binding: 'EMAIL_CODE_RATE_LIMIT', namespace: 2, perMinute: 5 },
  /** Public pages and their pictures are open to anyone. */
  publicRead: { binding: 'PUBLIC_READ_RATE_LIMIT', namespace: 4, perMinute: 300 },
  // Account paces, keyed by the account an operation acts for.
  /** The camera's garment check calls Clef, a few frames a second at most. */
  check: { binding: 'CAPTURE_CHECK_RATE_LIMIT', namespace: 3, perMinute: 40 },
  /** Reading a shop's page or a photo's address fetches someone else's site. */
  link: { binding: 'LINK_IMPORT_RATE_LIMIT', namespace: 5, perMinute: 10 },
  /** Generated pictures cost credits and a model's time. */
  generate: { binding: 'GENERATE_RATE_LIMIT', namespace: 6, perMinute: 6 },
  /** Outfits are free but call Clef. */
  outfit: { binding: 'OUTFIT_RATE_LIMIT', namespace: 7, perMinute: 30 },
  /** Thinking asks a model as well, so it keeps a tighter pace inside the outfit one. */
  thinking: { binding: 'THINKING_RATE_LIMIT', namespace: 8, perMinute: 6 },
  /** Upload paths: a long video goes up as 30-second parts with about thirty stills each, and a fast phone cuts several
   * parts a minute; a camera roll's selection asks for a few dozen at once. */
  upload: { binding: 'UPLOAD_RATE_LIMIT', namespace: 9, perMinute: 300 },
  /** Cutting the person out of a gallery photo is free, but SAM bills each call. */
  cutout: { binding: 'CUTOUT_RATE_LIMIT', namespace: 10, perMinute: 6 },
} as const satisfies Record<string, Pace>

export type PaceName = keyof typeof paces

/** A Workers RateLimit binding's runtime object. */
export interface Limiter {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>
}

/** Declare every pace's binding on the Worker, as Alchemy plans it. */
export const declarePaces = Effect.all(
  Record.map(paces, ({ binding, namespace, perMinute }) =>
    Effect.gen(function* () {
      const { firstRateLimitNamespace } = yield* currentStage
      return yield* Cloudflare.Workers.RateLimit(binding, {
        namespaceId: firstRateLimitNamespace + namespace,
        simple: { limit: perMinute, period: 60 },
      })
    }),
  ),
)

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
