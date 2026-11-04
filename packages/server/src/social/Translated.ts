import { Array, Order } from 'effect'
import { digestOf } from '../kernel/Ids.ts'

// The same board or profile in another language (owner, 4 November 2026). A translation keeps the digest of the
// original text it translated; it is shown only while the original is unchanged, so an owner's edit never leaves a
// translation of words that are gone.

/** What a board's translation translates: its name and its table's labels by item, as one digest. */
export const boardSourceDigest = (
  name: string,
  labels: ReadonlyArray<{ readonly id: string; readonly text: string }>,
) =>
  digestOf(
    JSON.stringify([
      name,
      Array.sort(
        labels.map(({ id, text }) => [id, text] as const),
        Order.mapInput(Order.String, ([id]: readonly [string, string]) => id),
      ),
    ]),
  )

/** What a profile's translation translates: its name and bio, as one digest. */
export const profileSourceDigest = (name: string, bio: string | null) => digestOf(JSON.stringify([name, bio ?? '']))
