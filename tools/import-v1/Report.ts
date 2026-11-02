import type { ImportStarted, ImportStatus } from '@styld/protocol'
import type { Refusal } from './Mapping.ts'

// What an import did, for the operator to reconcile: every exported v1 piece with its v2 piece and how it ended, the
// pieces refused before upload and why, and the counts. Written into the export's private folder, beside the export.

export interface ImportReport {
  readonly importId: string
  readonly accountId: string
  readonly accountCreated: boolean
  readonly counts: {
    readonly exported: number
    readonly refused: number
    readonly imported: number
    readonly ready: number
    readonly failed: number
    readonly waiting: number
  }
  /** v1 id → v2 piece id and how it ended. */
  readonly pieces: ReadonlyArray<{ readonly v1Id: string; readonly v2Id: string | null; readonly status: string }>
  readonly refusals: ReadonlyArray<{ readonly v1Id: string; readonly reason: Refusal }>
}

/** The report of an import as it settled. */
export const reportOf = (
  exported: number,
  refusals: ImportReport['refusals'],
  started: Pick<ImportStarted, 'accountCreated'>,
  status: ImportStatus,
): ImportReport => {
  const count = (wanted: string) => status.pieces.filter(({ status: ended }) => ended === wanted).length
  return {
    importId: status.importId,
    accountId: status.accountId,
    accountCreated: started.accountCreated,
    counts: {
      exported,
      refused: refusals.length,
      imported: status.pieces.filter(({ pieceId }) => pieceId !== null).length,
      ready: count('ready'),
      failed: count('failed'),
      waiting: count('waiting') + count('processing'),
    },
    pieces: status.pieces.map(({ v1Id, pieceId, status: ended }) => ({ v1Id, v2Id: pieceId, status: ended })),
    refusals,
  }
}

/** Whether every exported piece is accounted for: imported and ready, or refused, with nothing failed or waiting. */
export const reconciles = (report: ImportReport) =>
  report.counts.ready + report.counts.refused === report.counts.exported &&
  report.counts.failed === 0 &&
  report.counts.waiting === 0

/** One line of counts: no names, no ids. */
export const summaryOf = (report: ImportReport) => {
  const { exported, refused, imported, ready, failed, waiting } = report.counts
  const account = report.accountCreated ? 'a new account' : 'its existing account'
  return `Import ${report.importId} into ${account}: ${exported} exported, ${refused} refused, ${imported} imported (${ready} ready, ${failed} failed, ${waiting} still waiting) — ${reconciles(report) ? 'reconciled' : 'NOT reconciled'}`
}
