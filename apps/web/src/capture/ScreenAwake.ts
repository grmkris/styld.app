import { Effect } from 'effect'

/** Until the page is shown: a hidden page cannot hold the screen on. */
const untilVisible = Effect.callback<void>((resume, signal) => {
  const shown = () => {
    if (document.visibilityState !== 'visible') return
    document.removeEventListener('visibilitychange', shown)
    resume(Effect.void)
  }
  document.addEventListener('visibilitychange', shown, { signal })
  shown()
})

/** One screen wake lock, given back when its scope closes. */
const screenLock = Effect.acquireRelease(
  Effect.tryPromise(() => navigator.wakeLock.request('screen')),
  (sentinel) => Effect.ignore(Effect.tryPromise(() => sentinel.release())),
)

/** Until the browser lets go of the lock, as it does whenever the page is hidden. */
const untilReleased = (sentinel: WakeLockSentinel) =>
  Effect.callback<void>((resume, signal) => {
    sentinel.addEventListener('release', () => resume(Effect.void), { once: true, signal })
  })

/** Hold the screen on until the scope closes, asking again each time the page is shown after being
 * hidden. A browser without wake locks, or one that refuses, is left alone. */
export const holdScreenAwake = Effect.gen(function* () {
  yield* untilVisible
  yield* Effect.scoped(Effect.flatMap(screenLock, untilReleased))
}).pipe(Effect.forever, Effect.ignore)
