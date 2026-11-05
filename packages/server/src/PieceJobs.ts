import { Effect, Layer } from 'effect'
import { AccountLifecycle } from './AccountLifecycle.ts'
import { Captures } from './capture/Service.ts'
import { consumer } from './jobs/Jobs.ts'
import { module } from './kernel/Module.ts'
import { Photos } from './photos/Photos.ts'
import { pieceJobQueue, pieceJobs } from './wardrobe/Queue.ts'
import { Wardrobe } from './wardrobe/Wardrobe.ts'

/** The piece queue's consumer: every piece, capture, photo and account-deletion job goes through the one queue
 * (`wardrobe/Queue.ts`), so its consumer sits above the modules it hands each job to, not inside one of them. */
export const pieceQueue = module({
  layer: Layer.empty,
  consumers: [
    consumer(
      pieceJobQueue,
      Effect.map(
        Effect.all({ wardrobe: Wardrobe, lifecycle: AccountLifecycle, captures: Captures, photos: Photos }),
        pieceJobs,
      ),
    ),
  ],
})
