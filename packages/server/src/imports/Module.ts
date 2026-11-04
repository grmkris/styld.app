import { Effect, Layer } from 'effect'
import { account } from '../Account.ts'
import { Captures } from '../capture/Service.ts'
import { consumer } from '../jobs/Jobs.ts'
import { module } from '../kernel/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { importHandlers, pictureBackfillHandlers } from './Http.ts'
import { importCopySweep } from './Copies.ts'
import { Imports } from './Imports.ts'
import { importJobQueue, importJobs } from './Queue.ts'
import { ImportStore } from './Store.ts'

/** Wardrobes brought over from v1 at the switch: the admins' endpoints and the import queue; and the operator's
 * backfill of clean pictures, by the account's email. */
export const imports = module({
  layer: Imports.layer.pipe(Layer.provide([ImportStore.layer, wardrobe.layer, account.layer])),
  api: Layer.mergeAll(importHandlers, pictureBackfillHandlers),
  sweeps: [importCopySweep],
  consumers: [consumer(importJobQueue, Effect.map(Effect.all({ imports: Imports, captures: Captures }), importJobs))],
})
