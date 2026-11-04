/**
 * Re-types one account's pieces on a deployed stage with the Worker's own decision model (T-02, owner 3 November:
 * Eva's pieces on the preview, after the T-12 types are deployed), run by hand:
 *
 *   bun tools/retype-pieces.ts --database <D1 name> --bucket <R2 bucket> --account <id> [--out <report.json>] [--apply]
 *
 * Each ready piece's cut-out is read from R2 (the media bucket is in the EU jurisdiction) and asked the Worker's
 * `suggest` questions through the Cloudflare REST API and `makeGarmentVision`, so the answers are the ones a new piece
 * gets. Only two kinds of change are made, the ones a read of Eva's 310 pieces (3 November) showed right every time:
 * a piece moves into one of the types T-12 added, which did not exist when it was sorted (gloves and hairbands that
 * had been scarves, hiking boots that had been boots); and a pair of shoes loses a second colour Clef no longer
 * sees (a sole or a trim: a black snow boot was black, beige and white). Every other new answer is reported, not
 * written: on clean pictures Clef moved race shirts and pyjama trousers out of sportswear and loungewear, the wrong
 * way. With `--apply` each change is written only while the piece still has the type and colours it was read with,
 * so an edit made meanwhile wins. Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment and never
 * prints them; the report holds piece ids and types only, and stays outside Git.
 */
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { Colour, PieceType, slotOf } from '@styld/protocol'
import { modelPicture, readPng } from '@styld/imaging'
import { Effect, Option, Schema } from 'effect'
import { judgedAt } from '../packages/server/src/capture/Garments.ts'
import { CaptureMetrics } from '../packages/server/src/kernel/Metrics.ts'
import { makeGarmentVision } from '../packages/server/src/providers/Clef.ts'
import { cloudflareStage } from './CloudflareRest.ts'

const { values } = parseArgs({
  options: {
    database: { type: 'string' },
    bucket: { type: 'string' },
    account: { type: 'string' },
    out: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
})
const token = process.env['CLOUDFLARE_API_TOKEN']
const cloudflareAccount = process.env['CLOUDFLARE_ACCOUNT_ID']
const { database, bucket, account } = values
if (
  token === undefined ||
  cloudflareAccount === undefined ||
  database === undefined ||
  bucket === undefined ||
  account === undefined
)
  throw new Error(
    'Usage: bun tools/retype-pieces.ts --database <D1 name> --bucket <R2 bucket> --account <id> [--out <file>] ' +
      '[--apply], with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set',
  )

/** How sure Clef must be of a type's group before a stored piece is re-typed: a person's piece changes only on a clear
 * answer. */
const retypeBar = 0.7

/** The types T-12 added (3 November), which no stored piece could have been given. */
const addedTypes: ReadonlySet<PieceType> = new Set<PieceType>([
  'loafers',
  'laceUps',
  'sportShoes',
  'outdoorShoes',
  'gloves',
  'socks',
  'hairAccessories',
])

const Stored = Schema.Struct({
  id: Schema.String,
  type: PieceType,
  colours: Schema.fromJsonString(Schema.Array(Colour)),
  image_key: Schema.String,
})
type Stored = typeof Stored.Type

const { query, object, runClef } = await cloudflareStage({ token, cloudflareAccount, database, bucket })
const vision = makeGarmentVision(runClef, CaptureMetrics.discarding)

interface Change {
  readonly id: string
  readonly from: { readonly type: PieceType; readonly colours: ReadonlyArray<Colour> }
  readonly to: { readonly type: PieceType; readonly colours: ReadonlyArray<Colour> }
  /** What Clef answered, written or not. */
  readonly suggested: {
    readonly type: PieceType | undefined
    readonly confidence: number
    readonly colours: ReadonlyArray<Colour>
  }
}

const changeOf = (piece: Stored) =>
  Effect.gen(function* () {
    const decoded = readPng(yield* Effect.tryPromise(() => object(piece.image_key)))
    if (Option.isNone(decoded)) return Option.none<Change>()
    const suggestion = yield* vision.suggest(modelPicture(decoded.value, judgedAt))
    const type =
      suggestion.type !== undefined &&
      suggestion.confidence >= retypeBar &&
      addedTypes.has(suggestion.type) &&
      !addedTypes.has(piece.type)
        ? suggestion.type
        : piece.type
    const [main, second] = piece.colours
    const trimmed =
      slotOf(type) === 'shoes' &&
      main !== undefined &&
      second !== undefined &&
      main === suggestion.colours[0] &&
      !suggestion.colours.includes(second)
    const colours = trimmed ? [main] : piece.colours
    const suggested = { type: suggestion.type, confidence: suggestion.confidence, colours: suggestion.colours }
    return type === piece.type && !trimmed
      ? Option.none<Change>()
      : Option.some<Change>({
          id: piece.id,
          from: { type: piece.type, colours: piece.colours },
          to: { type, colours },
          suggested,
        })
  })

const pieces = await Schema.decodeUnknownPromise(Schema.Array(Stored))(
  await query(
    `SELECT id, type, colours, image_key FROM pieces
       WHERE account_id = ? AND status = 'ready' AND image_key IS NOT NULL AND image_key <> original_key
       ORDER BY created_at`,
    [account],
  ),
)

const found = await Effect.runPromise(
  Effect.forEach(
    pieces,
    (piece) =>
      changeOf(piece).pipe(
        Effect.orElseSucceed(() => {
          console.error(`${piece.id}: not read; left as it is`)
          return Option.none<Change>()
        }),
      ),
    { concurrency: 6 },
  ),
)
const changes = found.flatMap((change) => Option.toArray(change))

const out = values.out ?? `/tmp/retype-${account}.json`
await writeFile(out, JSON.stringify({ account, read: pieces.length, changes }, null, 2))
const count = (test: (change: Change) => boolean) => changes.filter(test).length
console.log(
  `${pieces.length} pieces read; ${count(({ from, to }) => from.type !== to.type)} re-typed, ` +
    `${count(({ from, to }) => from.colours.length !== to.colours.length)} pairs of shoes lose a trim's colour. ` +
    `Report: ${out}`,
)

if (values.apply) {
  const now = Date.now()
  let written = 0
  for (const { id, from, to } of changes) {
    const rows = await query(
      `UPDATE pieces SET type = ?, colours = ?, updated_at = ?
         WHERE id = ? AND account_id = ? AND type = ? AND colours = ? RETURNING id`,
      [to.type, JSON.stringify(to.colours), now, id, account, from.type, JSON.stringify(from.colours)],
    )
    written += rows.length
  }
  console.log(`${written} of ${changes.length} changes written; any other piece was edited meanwhile.`)
}
