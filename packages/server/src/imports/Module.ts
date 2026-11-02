import { Effect, Layer } from 'effect'
import { account } from '../Account.ts'
import { consumer } from '../jobs/Jobs.ts'
import { module } from '../kernel/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { importHandlers } from './Http.ts'
import { importCopySweep } from './Copies.ts'
import { Imports } from './Imports.ts'
import { importJobQueue, importJobs } from './Queue.ts'
import { ImportStore } from './Store.ts'

/** Wardrobes brought over from v1 at the switch: the admins' endpoints and the import queue. */
export const imports = module({
  layer: Imports.layer.pipe(Layer.provide([ImportStore.layer, wardrobe.layer, account.layer])),
  api: importHandlers,
  sweeps: [importCopySweep],
  consumers: [consumer(importJobQueue, Effect.map(Imports, importJobs))],
})
