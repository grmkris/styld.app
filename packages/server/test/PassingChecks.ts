import { Effect, Layer } from 'effect'
import { CheckQueue, Checks } from '../src/safety/Checks.ts'
import { ContentJudge, passed } from '../src/safety/Judge.ts'

/** Checks over the test's database whose judge passes everything and whose queue drops what it is sent. */
export const passingChecks = Checks.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(ContentJudge, ContentJudge.of({ judge: () => Effect.succeed(passed) })),
      CheckQueue.layer({ sendBatch: async () => undefined }),
    ),
  ),
)
