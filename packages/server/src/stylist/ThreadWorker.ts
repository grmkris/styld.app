import { stylistModel } from '../providers/StylistModel.ts'
import { styldModel } from './Policy.ts'
import { makeStylistThread, StylistThreads } from './Thread.ts'

// The Thread Worker: a plain module that exports the chats' Thread Object class (`Thread.ts`) over Styld's model.
// It has no public URL; the API Worker reaches its Objects through the `STYLIST_THREADS` namespace, and they reach
// the API Worker through `STYLD_API`. Alchemy's Effect Worker cannot export effect-cf's class, and an Alchemy Durable
// Object would own the alarm effect-cf drives, hence a Worker of its own.

export class StylistThread extends makeStylistThread(stylistModel(styldModel)) {}

export { StylistThreads }

export default {
  fetch: () => new Response(null, { status: 404 }),
}
