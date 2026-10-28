import { Effect, Option, Scope } from 'effect'

/**
 * Builds a value on the first request and keeps it for the Worker isolate.
 *
 * Alchemy also evaluates a Worker constructor while planning a deploy, when
 * request-only bindings such as secrets do not exist yet, so the build waits
 * for a request and receives that request's `input` as a plain value. It runs
 * with the constructor's services, never the first request's: a cached
 * service that captured that request's execution context or tracer hangs
 * every later request in workerd.
 *
 * Concurrent first callers share one build; an interrupted build is retried by
 * the next caller. The isolate scope is never closed (workerd has no teardown
 * hook), so the value must not own anything that needs cleanup.
 */
export const onFirstUse = <I, A, E, R>(build: (input: I) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const constructor = yield* Effect.context<Exclude<R, Scope.Scope>>()
    const isolate = yield* Scope.make()
    let first: Option.Option<I> = Option.none()
    const cached = yield* Effect.cached(
      Effect.suspend(() =>
        Option.isSome(first) ? build(first.value) : Effect.die(new Error('onFirstUse ran without an input')),
      ).pipe(Scope.provide(isolate)),
    )
    return (input: I): Effect.Effect<A, E> =>
      Effect.suspend(() => {
        if (Option.isNone(first)) first = Option.some(input)
        return cached
      }).pipe(Effect.updateContext((): typeof constructor => constructor))
  })
