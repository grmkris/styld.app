import { Effect, Queue, Stream } from 'effect'

// A browser observer (resize, intersection) as a Mount's stream: it watches the element while the Mount lives and
// disconnects when it ends.

interface Observer {
  readonly observe: (element: Element) => void
  readonly disconnect: () => void
}

/** What `make`'s observer offers, for as long as the stream runs. */
export const observed = <A>(element: Element, make: (offer: (value: A) => void) => Observer): Stream.Stream<A> =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const observer = make((value) => {
          Queue.offerUnsafe(queue, value)
        })
        observer.observe(element)
        return observer
      }),
      (observer) => Effect.sync(() => observer.disconnect()),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )
