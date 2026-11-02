import { Effect, Layer } from 'effect'
import { consumer } from '../jobs/Jobs.ts'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { generationHandlers } from './Http.ts'
import { generationJobQueue, generationJobs } from './Queue.ts'
import { Generations } from './Service.ts'

/** Stickers and mood boards Styld makes for boards, on their own queue. */
export const generation = module({
  layer: Generations.layer.pipe(Layer.provide([social.layer, wardrobe.layer])),
  api: generationHandlers,
  consumers: [consumer(generationJobQueue, Effect.map(Generations, generationJobs))],
  sweeps: [{ name: 'generation', run: Effect.flatMap(Generations, (owner) => owner.sweep()) }],
})
