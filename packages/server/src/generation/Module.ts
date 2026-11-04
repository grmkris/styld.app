import { Effect, Layer } from 'effect'
import { consumer } from '../jobs/Jobs.ts'
import type { Sweep } from '../jobs/Sweeps.ts'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { generationHandlers } from './Http.ts'
import { generationJobQueue, generationJobs } from './Queue.ts'
import { Generations } from './Service.ts'
import { TryOns } from './TryOn.ts'
import { tryOnHandlers } from './TryOnHttp.ts'

/** Each owner's sweep runs on its own, so one failing skips neither. */
const sweeps: ReadonlyArray<Sweep<Generations | TryOns>> = [
  { name: 'generation', run: Effect.flatMap(Generations, (owner) => owner.sweep()) },
  { name: 'tryOns', run: Effect.flatMap(TryOns, (owner) => owner.sweep()) },
]

/** Stickers and mood boards Styld makes for boards, and try-ons of the person's own photos, on their own queue. */
export const generation = module({
  layer: Layer.mergeAll(Generations.layer, TryOns.layer).pipe(Layer.provide([social.layer, wardrobe.layer])),
  api: Layer.mergeAll(generationHandlers, tryOnHandlers),
  consumers: [
    consumer(
      generationJobQueue,
      Effect.map(Effect.all([Generations, TryOns]), ([generations, tryOns]) => generationJobs(generations, tryOns)),
    ),
  ],
  sweeps,
})
