import { ImportPiece } from '@styld/protocol'
import { Context, Layer, Option, Schema } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import type { Imports } from './Imports.ts'

/** Queue message: import one v1 piece into the account, from the import's bundle. */
export const ImportMessage = Schema.TaggedUnion({
  ImportPiece: { importId: Schema.String, accountId: Schema.String, piece: ImportPiece },
})
export type ImportMessage = typeof ImportMessage.Type

/** The import queue's producer, as the Worker binds it: up to a hundred messages a call. */
export class ImportQueue extends Context.Service<
  ImportQueue,
  { sendBatch(messages: ReadonlyArray<{ readonly body: ImportMessage }>): Promise<unknown> }
>()('@styld/server/imports/ImportQueue') {
  static readonly layer = (queue: ImportQueue['Service']) => Layer.succeed(this, queue)
}

/** One piece a delivery, two deliveries at once: a cut-out asks Cloudflare Images several times, which answered 9529
 * (too many requests) at about ninety cut-outs a minute on the first import (2026-11-01), so an import keeps well under
 * that. A piece that does not import after three tries shows as failed in the report. */
export const importJobQueue = defineQueue({
  name: 'imports',
  body: ImportMessage,
  attempts: 3,
  batchSize: 1,
  maxConcurrency: 2,
  retryDelay: '30 seconds',
  jobOf: ({ piece }) => Option.some(piece.v1Id),
})

export const importJobs = (
  imports: Pick<Imports['Service'], 'importPiece' | 'giveUpPiece'>,
): JobsOf<ImportMessage> => ({
  ImportPiece: {
    run: (message) => imports.importPiece(message),
    giveUp: (message) => imports.giveUpPiece(message),
  },
})
