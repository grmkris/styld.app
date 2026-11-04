import { Effect, Layer } from 'effect'
import { BoardStore } from '../src/boards/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { Media } from '../src/kernel/Media.ts'
import { CheckQueue, Checks } from '../src/safety/Checks.ts'
import { ContentJudge, passed } from '../src/safety/Judge.ts'
import { PublicPages } from '../src/social/Public.ts'
import type { localD1 } from './LocalD1.ts'

/** Checks over the test's database whose judge passes everything and whose queue drops what it is sent. */
export const passingChecks = Checks.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(ContentJudge, ContentJudge.of({ judge: () => Effect.succeed(passed) })),
      CheckQueue.layer({ sendBatch: async () => undefined }),
    ),
  ),
)

/** Public pages over the test's database, its checks passing everything and its media never read. */
export const publicPagesOver = (database: ReturnType<typeof localD1>) =>
  PublicPages.layer.pipe(
    Layer.provide(BoardStore.layer),
    Layer.provideMerge(passingChecks),
    Layer.provideMerge(
      Layer.mergeAll(
        Database.layer(database),
        // SAFETY: the media binding is an empty fake -- reading a public page's words reads no object
        Layer.succeed(Media, Media.of({} as never)),
      ),
    ),
  )
