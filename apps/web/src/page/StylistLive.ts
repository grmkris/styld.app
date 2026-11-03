import { decodeLiveText, type LiveTextFrame } from '@yielded/agent-platform-cloudflare/live-text'
import { ThreadId } from '@yielded/agent/identifiers'
import { Match, Stream } from 'effect'

// The words of Styld's reply as its Thread writes them (Yielded LiveText), decoded in the browser: Ask Styld loads
// this module when a reply is being written, never in the first load. A draft is provisional: the chat read after the
// attempt ends is what stays. Any gap in the stream (a frame out of order, the connection lost) ends it, and the page
// reads the chat again.

/** The reply so far, or that its attempt ended and the chat holds what it wrote. */
export interface LiveDraft {
  readonly text: string
  readonly ended: boolean
}

/** The drafts being written, each a model turn's words, by turn. */
type Drafts = ReadonlyMap<string, string>

type Event = Extract<LiveTextFrame, { readonly _tag: 'Event' }>['event']

const textOf = (drafts: Drafts) => [...drafts.values()].join('')

/** One frame's change to the drafts, and whether the attempt ended with it. */
const applied = (drafts: Drafts, frame: LiveTextFrame): readonly [Drafts, boolean] =>
  Match.value(frame).pipe(
    Match.tag('Reset', (): readonly [Drafts, boolean] => [new Map(), false]),
    Match.tag('Event', ({ event }) => appliedEvent(drafts, event)),
    Match.exhaustive,
  )

const appliedEvent = (drafts: Drafts, event: Event): readonly [Drafts, boolean] =>
  Match.value(event).pipe(
    Match.tag('AttemptEnded', ({ attemptId }): readonly [Drafts, boolean] => [
      new Map([...drafts].filter(([key]) => !key.startsWith(`${JSON.stringify(attemptId)},`))),
      true,
    ]),
    Match.tag('Discard', (discarded): readonly [Drafts, boolean] => {
      const next = new Map(drafts)
      next.delete(keyOf(discarded))
      return [next, false]
    }),
    Match.tag('Text', (text): readonly [Drafts, boolean] => {
      if (text.part.type !== 'text-delta') return [drafts, false]
      const key = keyOf(text)
      return [new Map(drafts).set(key, `${drafts.get(key) ?? ''}${text.part.delta}`), false]
    }),
    Match.exhaustive,
  )

/** A model turn's draft key: its attempt first, so an ended attempt's drafts go together. */
const keyOf = (event: {
  readonly attemptId: string
  readonly runId: string
  readonly turnId: string
  readonly generation: number
}) => [event.attemptId, event.runId, event.turnId, event.generation].map((part) => JSON.stringify(part)).join(',')

/** The reply so far from the chat's live words, as they come. */
export const followLive = <E>(thread: string, bytes: Stream.Stream<Uint8Array, E>) =>
  decodeLiveText(ThreadId.make(thread), bytes).pipe(
    Stream.mapAccum(
      (): Drafts => new Map(),
      (drafts, frame) => {
        const [next, ended] = applied(drafts, frame)
        return [next, [{ text: textOf(next), ended }]] as const
      },
    ),
  )
