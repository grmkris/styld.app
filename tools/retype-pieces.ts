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
import { pieces as pieceTable } from '@styld/db'
import { modelPicture, readPng } from '@styld/imaging'
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { judgedAt } from '../packages/server/src/capture/Garments.ts'
import { CaptureMetrics } from '../packages/server/src/kernel/Metrics.ts'
import type { Picture } from '../packages/server/src/capture/Providers.ts'
import { makeGarmentVision } from '../packages/server/src/providers/Clef.ts'
import { cloudflareStage, stageOptions, statements } from './CloudflareRest.ts'

const { values } = parseArgs({ options: { ...stageOptions } })
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
  original_key: Schema.String,
  content_type: Schema.String,
})
type Stored = typeof Stored.Type

/** The picture types Clef reads. */
const Readable = Schema.Literals(['image/jpeg', 'image/png', 'image/webp'])

/** The photo a piece was cut from, read beside its cut-out as the Worker reads a new one; the browser stores it at
 * most 2048 px, so it is sent as stored. A type Clef cannot read leaves the cut-out to be read alone. */
const sourceOf = (piece: Stored) =>
  Option.match(Schema.decodeUnknownOption(Readable)(piece.content_type), {
    onNone: () => Effect.succeed(Option.none<Picture>()),
    onSome: (contentType) =>
      Effect.tryPromise(() => object(piece.original_key)).pipe(
        Effect.map((bytes) => Option.some<Picture>({ bytes, contentType })),
        Effect.orElseSucceed(() => Option.none<Picture>()),
      ),
  })

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
    const suggestion = yield* vision.suggest(modelPicture(decoded.value, judgedAt), yield* sourceOf(piece))
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
    statements
      .select({
        id: pieceTable.id,
        type: pieceTable.type,
        colours: pieceTable.colours,
        image_key: pieceTable.imageKey,
        original_key: pieceTable.originalKey,
        content_type: pieceTable.contentType,
      })
      .from(pieceTable)
      .where(
        and(
          eq(pieceTable.accountId, account),
          eq(pieceTable.status, 'ready'),
          isNotNull(pieceTable.imageKey),
          ne(pieceTable.imageKey, pieceTable.originalKey),
        ),
      )
      .orderBy(asc(pieceTable.createdAt)),
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
  const now = new Date()
  let written = 0
  for (const { id, from, to } of changes) {
    const rows = await query(
      statements
        .update(pieceTable)
        .set({ type: to.type, colours: to.colours, updatedAt: now })
        .where(
          and(
            eq(pieceTable.id, id),
            eq(pieceTable.accountId, account),
            eq(pieceTable.type, from.type),
            eq(pieceTable.colours, from.colours),
          ),
        )
        .returning({ id: pieceTable.id }),
    )
    written += rows.length
  }
  console.log(`${written} of ${changes.length} changes written; any other piece was edited meanwhile.`)
}
