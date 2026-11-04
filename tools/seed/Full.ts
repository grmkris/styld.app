import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { groupOf, OperationId, type SeedPiece } from '@styld/protocol'
import { capturePolicy } from '../../packages/server/src/capture/Policy.ts'
import { operatorStage, required } from '../OperatorStage.ts'
import { r2Bucket } from '../R2Rest.ts'
import type { Catalogue } from './Catalogue.ts'
import { generateAll, type GarmentWork } from './Garments.ts'
import type { Manifest } from './Manifest.ts'
import { planOf, type SeedPlan } from './Plan.ts'
import { seedReport } from './Report.ts'
import { checkedBoards, importAccount, type ReadyGarment, type SeedDeps, seedBoards } from './Seeder.ts'
import { operatorApi } from './Stage.ts'

// The full seed against a stage (owner, 4 November 2026: only after the test batch is approved): every garment the
// catalogue needs generated and judged, each account's imported, its profile, then every board in publish order and
// a wait for their checks; the report goes to `tools/seed/.out/report.md`. The stage comes from the operator's env
// file: `STYLD_URL`, `STYLD_OPERATOR_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_BUCKET` for the
// bundle.

/** A house garment Clef read as a scrap or another kind of garment, or one not cut out or not ready: the server
 * refuses the boards that need it (`seed/Seeding.ts`). */
const needsALook = (piece: SeedPiece) =>
  piece.status !== 'ready' ||
  !piece.cutOut ||
  (piece.describedWhole !== null && piece.describedWhole < capturePolicy.garments.whole.drop) ||
  (piece.describedType !== null && groupOf(piece.describedType) !== groupOf(piece.type))

/** The stage the operator's env file names, as the seed reaches it. */
export const stageDeps = (work: GarmentWork, pieces: string): SeedDeps => {
  const { origin, operatorToken } = operatorStage()
  return {
    api: operatorApi(origin, operatorToken),
    bucket: r2Bucket({
      cloudflareAccount: required('CLOUDFLARE_ACCOUNT_ID'),
      bucket: required('R2_BUCKET'),
      token: required('CLOUDFLARE_API_TOKEN'),
    }),
    ledger: work.ledger,
    picture: async (file) => new Uint8Array(await readFile(path.join(pieces, file))),
    log: (line) => console.log(line),
    sleep: (millis) => Bun.sleep(millis),
  }
}

/** The garments that passed, ready to import, by manifest id. */
const readyGarments = async (
  plan: SeedPlan,
  manifest: Manifest,
  work: GarmentWork,
  regenerate: ReadonlyArray<string>,
) => {
  const needed = new Set(plan.accounts.flatMap(({ garments }) => garments))
  const records = await generateAll(
    manifest.specs.filter(({ id }) => needed.has(id)),
    work,
    regenerate,
  )
  const ready = new Map<string, ReadyGarment>(
    records.flatMap(({ record, spec }) => {
      const passed = record.attempts.find((attempt) => attempt.passed)
      return record.status === 'passed' && passed !== undefined
        ? [[spec.id, { spec, file: passed.file, promptDigest: record.promptDigest }] as const]
        : []
    }),
  )
  return { ready, failed: new Set([...needed].filter((id) => !ready.has(id))) }
}

/** The full seed, written up in the report; the report's path. */
export const fullRun = async (input: {
  readonly catalogue: Catalogue
  readonly manifest: Manifest
  readonly work: GarmentWork
  readonly deps: SeedDeps
  readonly regenerate: ReadonlyArray<string>
  readonly out: string
}) => {
  const { deps, work } = input
  const plan = planOf(input.catalogue, input.manifest)
  const musesBefore = work.ledger.byKind('muse')
  const { ready, failed } = await readyGarments(plan, input.manifest, work, input.regenerate)
  let imported = 0
  for (const planned of plan.accounts)
    imported += await importAccount(
      deps,
      planned,
      planned.garments.flatMap((id) => {
        const garment = ready.get(id)
        return garment === undefined ? [] : [garment]
      }),
    )
  const stood = await Promise.all(plan.accounts.map(({ account }) => deps.api.pieces(account.email)))
  for (const planned of plan.accounts)
    deps.log(`${planned.account.id}: profile ${(await deps.api.profile(planned.profile)).outcome}`)
  const results = await checkedBoards(deps, plan, await seedBoards(deps, plan, failed))
  const report = seedReport({
    at: new Date().toISOString(),
    spend: {
      muse: work.ledger.byKind('muse'),
      judge: work.ledger.byKind('judge'),
      cutout: work.ledger.byKind('cutout'),
    },
    generated: Math.round((work.ledger.byKind('muse') - musesBefore) / 10_000),
    imported,
    failedSpecs: [...failed],
    needsALook: stood.flatMap(({ pieces }) => pieces.filter(needsALook).map(({ manifestId }) => manifestId)),
    results,
  })
  const file = path.join(input.out, 'report.md')
  await writeFile(file, `${report}\n`)
  return { file, results }
}

/** Take the named seeded boards down (a fixture's, or an entry the catalogue no longer has). */
export const pruned = async (deps: SeedDeps, plan: SeedPlan, seedIds: ReadonlyArray<string>) => {
  for (const seedId of seedIds) {
    const email = plan.boards.find((board) => board.seedId === seedId)?.request.email
    if (email === undefined) throw new Error(`${seedId} is not in the catalogue`)
    await deps.api.remove(seedId, { operationId: OperationId.make(`seed-remove-${crypto.randomUUID()}`), email })
    deps.log(`${seedId}: removed`)
  }
}
