import { Effect } from 'effect'

const notUsed = () => Effect.die('not used by these tests')

/** Services the assistants' tools are built over, none of them used: tests about other tools spread these. */
export const unusedServices = {
  generations: { admit: notUsed, get: notUsed },
  outfits: { make: notUsed, sweep: notUsed },
  tryOns: { start: notUsed, get: notUsed, list: notUsed, delete: notUsed, toBoard: notUsed },
  photos: { listPhotos: notUsed, getPhoto: notUsed },
  feedback: { send: notUsed },
}
