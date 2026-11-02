import { PieceId } from '@styld/protocol'
import { describe, expect, test } from 'vitest'
import { reconciles, reportOf, summaryOf } from './Report.ts'

type Ending = 'waiting' | 'processing' | 'ready' | 'failed'

const status = (pieces: ReadonlyArray<{ v1Id: string; pieceId: string | null; status: Ending }>) => ({
  importId: 'v1-0123456789abcdef01234567',
  accountId: 'account',
  pieces: pieces.map((piece) => ({
    v1Id: piece.v1Id,
    pieceId: piece.pieceId === null ? null : PieceId.make(piece.pieceId),
    status: piece.status,
  })),
})

describe('an import report', () => {
  test('maps v1 ids to v2 ids, counts every ending, and reconciles when nothing failed or waits', () => {
    const report = reportOf(
      3,
      [{ v1Id: 'v1-c', reason: 'placeholder' }],
      { accountCreated: true },
      status([
        { v1Id: 'v1-a', pieceId: `pc_${'a'.repeat(22)}`, status: 'ready' },
        { v1Id: 'v1-b', pieceId: `pc_${'b'.repeat(22)}`, status: 'ready' },
      ]),
    )
    expect(report.counts).toEqual({ exported: 3, refused: 1, imported: 2, ready: 2, failed: 0, waiting: 0 })
    expect(report.pieces[0]).toEqual({ v1Id: 'v1-a', v2Id: `pc_${'a'.repeat(22)}`, status: 'ready' })
    expect(reconciles(report)).toBe(true)
    expect(summaryOf(report)).toContain('reconciled')
  })

  test('does not reconcile with a failed or waiting piece', () => {
    const report = reportOf(
      2,
      [],
      { accountCreated: false },
      status([
        { v1Id: 'v1-a', pieceId: `pc_${'a'.repeat(22)}`, status: 'failed' },
        { v1Id: 'v1-b', pieceId: null, status: 'waiting' },
      ]),
    )
    expect(report.counts).toMatchObject({ failed: 1, waiting: 1, imported: 1 })
    expect(reconciles(report)).toBe(false)
    expect(summaryOf(report)).toContain('NOT reconciled')
  })
})
