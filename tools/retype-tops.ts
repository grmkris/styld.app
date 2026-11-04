/**
 * Sorts the tops of a deployed stage by sleeve (P4, Eva's review, 4 November: "I'd split tops and T-shirts into short,
 * long and sleeveless"), run by hand once the three types are deployed:
 *
 *   bun tools/retype-tops.ts --database <D1 name> --bucket <R2 bucket> [--account <id>] [--before <ISO time>]
 *     [--out <report.json>] [--apply]
 *
 * The migration made every stored `tops` a short-sleeved top. Each ready short-sleeved top (of one account, or of
 * every account without `--account`; made before `--before` when given, so pieces sorted since are left alone) has its
 * cut-out read from R2 and Clef asked only about its sleeves, through the Cloudflare REST API as the Worker asks it.
 * A top moves to long-sleeved or sleeveless only when Clef gives that answer at least `sleeveBar` (Sleeves.ts); every
 * other answer, a short-sleeved one included, leaves it as it is. Dry by default: the report lists what would move and what Clef
 * was unsure of, to check a sample against the pictures by eye. With `--apply` a move is written only while the piece
 * is still a short-sleeved top, so an edit made meanwhile wins. Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 * from the environment and never prints them; the report holds piece and account ids and types only, and stays
 * outside Git.
 */
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { PieceType } from '@styld/protocol'
import { modelPicture, readPng } from '@styld/imaging'
import { Effect, Option, Schema } from 'effect'
import { judgedAt } from '../packages/server/src/capture/Garments.ts'
import { CaptureMetrics } from '../packages/server/src/kernel/Metrics.ts'
import { askClef, imageOf } from '../packages/server/src/providers/Clef.ts'
import { cloudflareStage, stageOptions } from './CloudflareRest.ts'
import { sleeveBar, type SleeveRead, sleeveQuestions, sleeveRead } from './Sleeves.ts'

const { values } = parseArgs({ options: { ...stageOptions, before: { type: 'string' } } })
const token = process.env['CLOUDFLARE_API_TOKEN']
const cloudflareAccount = process.env['CLOUDFLARE_ACCOUNT_ID']
const { database, bucket, account } = values
const before = values.before === undefined ? undefined : Date.parse(values.before)
if (
  token === undefined ||
  cloudflareAccount === undefined ||
  database === undefined ||
  bucket === undefined ||
  Number.isNaN(before)
)
  throw new Error(
    'Usage: bun tools/retype-tops.ts --database <D1 name> --bucket <R2 bucket> [--account <id>] ' +
      '[--before <ISO time>] [--out <file>] [--apply], with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set',
  )

const from = 'shortSleeveTops' satisfies PieceType

const Stored = Schema.Struct({ id: Schema.String, account_id: Schema.String, image_key: Schema.String })
type Stored = typeof Stored.Type

const { query, object, runClef } = await cloudflareStage({ token, cloudflareAccount, database, bucket })

interface Read extends SleeveRead {
  readonly id: string
  readonly accountId: string
}

const readOf = (piece: Stored) =>
  Effect.gen(function* () {
    const decoded = readPng(yield* Effect.tryPromise(() => object(piece.image_key)))
    if (Option.isNone(decoded)) return Option.none<Read>()
    const answer = yield* askClef(runClef, CaptureMetrics.discarding, 'suggest', {
      model: 'clef-flash',
      state: 'One top cut out of a photo of clothes.',
      images: [imageOf(modelPicture(decoded.value, judgedAt))],
      questions: sleeveQuestions,
    })
    return Option.some<Read>({ id: piece.id, accountId: piece.account_id, ...sleeveRead(answer) })
  })

const filters = [
  ...(account === undefined ? [] : [{ sql: 'account_id = ?', value: account }]),
  ...(before === undefined ? [] : [{ sql: 'created_at < ?', value: before }]),
]
const pieces = await Schema.decodeUnknownPromise(Schema.Array(Stored))(
  await query(
    `SELECT id, account_id, image_key FROM pieces
       WHERE type = ? AND status = 'ready' AND image_key IS NOT NULL AND image_key <> original_key
         ${filters.map(({ sql }) => `AND ${sql}`).join(' ')}
       ORDER BY created_at`,
    [from, ...filters.map(({ value }) => value)],
  ),
)

const found = await Effect.runPromise(
  Effect.forEach(
    pieces,
    (piece) =>
      readOf(piece).pipe(
        Effect.orElseSucceed(() => {
          console.error(`${piece.id}: not read; left as it is`)
          return Option.none<Read>()
        }),
      ),
    { concurrency: 6 },
  ),
)
const reads = found.flatMap((read) => Option.toArray(read))
const moves = reads.filter((read) => read.to !== undefined)
const unsure = reads.filter(
  (read) => read.to === undefined && (read.sleeve !== 'short' || read.probability < sleeveBar),
)

const out = values.out ?? `/tmp/retype-tops-${account ?? 'all'}.json`
await writeFile(out, JSON.stringify({ account: account ?? null, read: pieces.length, moves, unsure }, null, 2))
const count = (type: PieceType) => moves.filter(({ to }) => to === type).length
console.log(
  `${pieces.length} short-sleeved tops read, ${reads.length} answered; ${count('longSleeveTops')} move to long ` +
    `sleeves, ${count('sleevelessTops')} to sleeveless, ${unsure.length} left as they are on an unsure answer. ` +
    `Report: ${out}`,
)

if (values.apply) {
  const now = Date.now()
  let written = 0
  for (const { id, accountId, to } of moves) {
    if (to === undefined) continue
    const rows = await query(
      `UPDATE pieces SET type = ?, updated_at = ? WHERE id = ? AND account_id = ? AND type = ? RETURNING id`,
      [to, now, id, accountId, from],
    )
    written += rows.length
  }
  console.log(`${written} of ${moves.length} moves written; any other piece was edited meanwhile.`)
}
