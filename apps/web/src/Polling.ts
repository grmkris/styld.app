import { Array, Duration, Schema, Stream } from 'effect'
import type { Subscription } from 'foldkit'

// How a page follows work the server finishes later (a piece processing, a photo's garments being found, a capture in
// the review tray, a reply being written): one Subscription per page, driven by the ids still pending in its Model. It
// ticks only while there are any, and only while the page is open (the app lifts it through the page's lens), so a
// closed page or settled work stops it. A tick asks again through `Update.refresh` with `AsyncData.revalidate`, which
// skips a request already on its way: polls never stack. A poll's answer merges into the page's data and leaves the
// page's own work (a change being sent, one that failed) as it was. A failed poll keeps what was shown; after
// `mostMisses` in a row the page stops following and offers Try again, which starts it over.

/** How long a page waits between asking again: new work settles within seconds. */
const pollPause = Duration.seconds(2)

/** Polls in a row that may fail before a page stops following its work. */
const mostMisses = 5

/** Polls in a row that did not get through; any answer starts the count over. */
export const Misses = Schema.Int
export type Misses = typeof Misses.Type

/** Whether a page has stopped following its work after too many failed polls. */
export const hasStopped = (misses: Misses) => misses >= mostMisses

const PendingIds = Schema.Struct({ pendingIds: Schema.Array(Schema.String) })

/** A Subscription entry that sends `tick` every `pause` (two seconds unless given) while `pendingIds` lists anything
 * and the page has not stopped after too many misses; a change in what is pending starts the pause over. */
export const pollWhilePending = <Model, Message>(config: {
  readonly pendingIds: (model: Model) => ReadonlyArray<string>
  readonly misses: (model: Model) => Misses
  readonly tick: Message
  readonly pause?: Duration.Duration
}): Subscription.EntryWithoutKeepAlive<Model, Message, typeof PendingIds.Type, never> => ({
  dependenciesSchema: PendingIds,
  modelToDependencies: (model) => ({ pendingIds: hasStopped(config.misses(model)) ? [] : config.pendingIds(model) }),
  dependenciesToStream: ({ pendingIds }) =>
    Array.isReadonlyArrayEmpty(pendingIds)
      ? Stream.empty
      : Stream.tick(config.pause ?? pollPause).pipe(
          Stream.drop(1),
          Stream.map(() => config.tick),
        ),
})
