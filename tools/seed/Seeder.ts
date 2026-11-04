import { createHash } from 'node:crypto'
import type { CheckState, ImportManifest, ImportStatus } from '@styld/protocol'
import { Predicate } from 'effect'
import { type Ledger, prices } from './Ledger.ts'
import type { Spec } from './Manifest.ts'
import { importPieceOf, type PlannedAccount, type PlannedBoard, type SeedPlan } from './Plan.ts'
import type { Bucket, OperatorApi } from './Stage.ts'

// The seed's writes to a stage, in order (owner, 4 November 2026): each account's passing garments imported as house
// garments, its profile, then every board in publish order, then a wait for the boards' checks. Each step answers what
// it did, for the report; a second run of the same catalogue imports, creates and changes nothing.

/** What the seed needs of the stage and the machine. */
export interface SeedDeps {
  readonly api: OperatorApi
  readonly bucket: Bucket
  readonly ledger: Ledger
  readonly picture: (file: string) => Promise<Uint8Array>
  readonly log: (line: string) => void
  readonly sleep: (millis: number) => Promise<void>
}

/** A garment ready to import: its spec, its picture's file and its prompt's digest. */
export interface ReadyGarment {
  readonly spec: Spec
  readonly file: string
  readonly promptDigest: string
}

const settledIn = (status: ImportStatus) =>
  status.pieces.every(({ status: now }) => now !== 'waiting' && now !== 'processing')

/** How long an import may take: the import queue cuts out about ninety pieces a minute at most. */
const importPatience = 2 * 60 * 60 * 1000

/** Import an account's garments as house garments: the bundle uploaded, the import started (only pieces not ready yet
 * are sent), its cut-outs charged, and waited for until every piece settled. How many it sent. */
export const importAccount = async (deps: SeedDeps, planned: PlannedAccount, garments: ReadonlyArray<ReadyGarment>) => {
  if (garments.length === 0) return 0
  const manifest: ImportManifest = {
    version: 1,
    email: planned.account.email,
    displayName: planned.account.displayName,
    pieces: garments.map(({ spec, promptDigest }) => importPieceOf(spec, promptDigest)),
  }
  const importId = `seed-${createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 24)}`
  const prefix = `imports/${importId}/`
  for (const { spec, file } of garments)
    await deps.bucket.write(`${prefix}pictures/${spec.id}`, await deps.picture(file), { type: 'image/png' })
  await deps.bucket.write(`${prefix}manifest.json`, JSON.stringify(manifest), { type: 'application/json' })
  // What the import will send is what is not ready before it starts: a start repeated under its operation id answers
  // from its first receipt, as things stood then. An account the import has not made yet has nothing ready.
  const before = await deps.api.importStatus(importId).catch(() => undefined)
  const sent = manifest.pieces.length - (before?.pieces.filter(({ status }) => status === 'ready').length ?? 0)
  await deps.api.startImport(importId, `start-${importId}`)
  if (sent > 0)
    await deps.ledger.paid(
      { kind: 'cutout', ref: importId, worst: sent * prices.cutoutPerPiece },
      async () => sent,
      () => sent * prices.cutoutPerPiece,
      () => sent * prices.cutoutPerPiece,
    )
  const since = Date.now()
  let status = await deps.api.importStatus(importId)
  while (!settledIn(status) && Date.now() - since < importPatience) {
    deps.log(
      `${planned.account.id}: ${String(status.pieces.filter((piece) => piece.status === 'ready').length)} of ${String(status.pieces.length)} ready`,
    )
    await deps.sleep(15_000)
    status = await deps.api.importStatus(importId)
  }
  if (settledIn(status)) {
    for (const { spec } of garments) await deps.bucket.delete(`${prefix}pictures/${spec.id}`)
    await deps.bucket.delete(`${prefix}manifest.json`)
  }
  return sent
}

/** What became of a board. */
export interface BoardResult {
  readonly seedId: string
  readonly owner: PlannedBoard['owner']
  readonly audience: PlannedBoard['audience']
  readonly featured: boolean
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'
  readonly boardId: string | null
  readonly visibility: 'private' | 'public' | null
  readonly check: CheckState | null
  readonly detail: ReadonlyArray<string>
}

const failedResult = (
  planned: PlannedBoard,
  outcome: 'skipped' | 'failed',
  detail: ReadonlyArray<string>,
): BoardResult => ({
  seedId: planned.seedId,
  owner: planned.owner,
  audience: planned.audience,
  featured: planned.featured,
  outcome,
  boardId: null,
  visibility: null,
  check: null,
  detail,
})

/** Seed every board in publish order, one at a time, skipping those that need a garment that failed. */
export const seedBoards = async (deps: SeedDeps, plan: SeedPlan, failed: ReadonlySet<string>) => {
  const results: Array<BoardResult> = []
  for (const planned of plan.boards) {
    const { board } = planned.request
    const wanting = [...board.pieces, ...(board.anchor === undefined ? [] : [board.anchor])].filter((id) =>
      failed.has(id),
    )
    if (wanting.length > 0) {
      results.push(failedResult(planned, 'skipped', wanting))
      continue
    }
    try {
      const seeded = await deps.api.board(planned.seedId, planned.request)
      deps.log(`${planned.seedId}: ${seeded.outcome}`)
      results.push({ ...failedResult(planned, 'failed', []), ...seeded, detail: [] })
    } catch (error) {
      const body = Predicate.hasProperty(error, 'body') ? [String(error.body)] : []
      results.push(failedResult(planned, 'failed', [error instanceof Error ? error.message : 'failed', ...body]))
    }
  }
  return results
}

/** How long the seed waits for the boards' checks before it reports them as they stand. */
const checkPatience = 10 * 60 * 1000

/** Wait until no seeded board's check is pending, or the patience runs out; the boards as they stand then. */
export const checkedBoards = async (deps: SeedDeps, plan: SeedPlan, results: ReadonlyArray<BoardResult>) => {
  const emails = new Map(plan.boards.map(({ seedId, request }) => [seedId, request.email]))
  const since = Date.now()
  let current = results
  while (
    current.some(({ check, boardId }) => boardId !== null && check === 'pending') &&
    Date.now() - since < checkPatience
  ) {
    await deps.sleep(10_000)
    current = await Promise.all(
      current.map(async (result) =>
        result.boardId === null || result.check !== 'pending'
          ? result
          : { ...result, ...(await deps.api.status(result.seedId, emails.get(result.seedId) ?? '')) },
      ),
    )
  }
  return current
}
