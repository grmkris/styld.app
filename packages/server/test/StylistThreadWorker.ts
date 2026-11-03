import { makeStylistThread, StylistThreads } from '../src/stylist/Thread.ts'
import { fakeStylistModel } from './fakes/StylistModel.ts'

// The Thread Worker as the native suite runs it: the same Thread Object class over the streaming fake model
// (`fakes/StylistModel.ts`), bound to the native API Worker like the deployed one (`RuntimeStack.ts`).

export class StylistThread extends makeStylistThread(fakeStylistModel) {}

export { StylistThreads }

export default {
  fetch: () => new Response(null, { status: 404 }),
}
