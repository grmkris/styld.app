import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Record } from 'effect'
import { declarePaces } from './kernel/Paces.ts'
import {
  StyldAiCalls,
  StyldChecksQueue,
  StyldDatabase,
  StyldEmail,
  StyldGenerationQueue,
  StyldImportQueue,
  StyldMedia,
  StyldPieceQueue,
} from './Resources.ts'

/** The Worker's bindings, declared while Alchemy plans the stack. */
export const declareBindings = Effect.gen(function* () {
  // Each queue's resource, declared once: its producer binding and its consumer share it.
  const queues = {
    pieces: yield* StyldPieceQueue,
    checks: yield* StyldChecksQueue,
    generation: yield* StyldGenerationQueue,
    imports: yield* StyldImportQueue,
  }
  return {
    database: yield* Cloudflare.D1.QueryDatabase(StyldDatabase),
    email: yield* Cloudflare.Email.Send(yield* StyldEmail),
    media: yield* Cloudflare.R2.ReadWriteBucket(StyldMedia),
    images: yield* Cloudflare.Images.Images('STYLD_IMAGES'),
    queues,
    writers: yield* Effect.all(Record.map(queues, (queue) => Cloudflare.Queues.WriteQueue(queue))),
    // Clef-flash (Workers AI); provider calls are counted in Analytics Engine.
    ai: yield* Cloudflare.Workers.AI('AI'),
    calls: yield* Cloudflare.AnalyticsEngine.WriteDataset(yield* StyldAiCalls),
    // Every pace's Workers RateLimit binding (`kernel/Pacing.ts`).
    paces: yield* declarePaces,
  }
})

export type Bindings = Effect.Success<typeof declareBindings>
