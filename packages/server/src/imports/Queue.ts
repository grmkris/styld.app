import { ImportPiece } from '@styld/protocol'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import type { Captures } from '../capture/Service.ts'
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

/** An imported piece, then its first clean picture once it is ready as a cut-out, as a piece kept from the tray gets
 * one (owner, 4 November 2026); a redelivery queues no picture twice. */
export const importJobs = (services: {
  readonly imports: Pick<Imports['Service'], 'importPiece' | 'giveUpPiece'>
  readonly captures: Pick<Captures['Service'], 'drawImported'>
}): JobsOf<ImportMessage> => ({
  ImportPiece: {
    run: (message) => Effect.flatMap(services.imports.importPiece(message), services.captures.drawImported),
    giveUp: (message) => services.imports.giveUpPiece(message),
  },
})
