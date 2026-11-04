/**
 * Sorts the sport tops of a deployed stage into the four Sport types (owner, 4 November: Eva found leggings and sports
 * bras sorted wrong), run by hand once the types are deployed:
 *
 *   bun tools/retype-sport.ts --database <D1 name> --bucket <R2 bucket> [--account <id>] [--out <report.json>] [--apply]
 *
 * The migration made every stored `sportswear` a sport top. Each ready sport top (of one account, or of every account
 * without `--account`) is shown to Clef as its cut-out and, beside it, the photo it was cut from, so a pair of leggings
 * is read with the person wearing them; Clef is asked only which kind of sportswear it is, through the Cloudflare REST
 * API as the Worker asks it. A piece moves to sports bras, sport bottoms or tracksuits only on that answer at least
 * `sportBar` (Sport.ts); a top, an unsure answer or "not sport" leaves it where it is and is reported. Dry by default,
 * to check a sample against the pictures by eye; with `--apply` a move is written only while the piece is still a sport
 * top, so an edit made meanwhile wins. Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment and
 * never prints them; the report holds piece and account ids and kinds only, and stays outside Git.
 */
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { PieceType } from '@styld/protocol'
import { modelPicture, readPng } from '@styld/imaging'
import { Effect, Option, Schema } from 'effect'
import type { Picture } from '../packages/server/src/capture/Providers.ts'
import { judgedAt } from '../packages/server/src/capture/Garments.ts'
import { CaptureMetrics } from '../packages/server/src/kernel/Metrics.ts'
import { askClef, imageOf } from '../packages/server/src/providers/Clef.ts'
import { cloudflareStage, readEach, stageOptions } from './CloudflareRest.ts'
import { sportBar, type SportRead, sportQuestions, sportRead } from './Sport.ts'

const { values } = parseArgs({ options: stageOptions })
const token = process.env['CLOUDFLARE_API_TOKEN']
const cloudflareAccount = process.env['CLOUDFLARE_ACCOUNT_ID']
const { database, bucket, account } = values
if (token === undefined || cloudflareAccount === undefined || database === undefined || bucket === undefined)
  throw new Error(
    'Usage: bun tools/retype-sport.ts --database <D1 name> --bucket <R2 bucket> [--account <id>] [--out <file>] ' +
      '[--apply], with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set',
  )

const from = 'sportTops' satisfies PieceType

/** The largest photo sent beside the cut-out; a larger one is left out and the cut-out read alone. */
const mostPhotoBytes = 4_000_000

const Stored = Schema.Struct({
  id: Schema.String,
  account_id: Schema.String,
  image_key: Schema.String,
  original_key: Schema.String,
  content_type: Schema.String,
})
type Stored = typeof Stored.Type

const { query, object, runClef } = await cloudflareStage({ token, cloudflareAccount, database, bucket })

interface Read extends SportRead {
  readonly id: string
  readonly accountId: string
  /** Whether the photo was read beside the cut-out. */
  readonly withPhoto: boolean
}

const photoContentTypes: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp'])
const isPhotoType = (contentType: string): contentType is Picture['contentType'] => photoContentTypes.has(contentType)

/** The photo the piece was cut from, when it is one Clef reads and small enough to send. */
const photoOf = (piece: Stored) =>
  Effect.gen(function* () {
    const contentType = piece.content_type
    if (!isPhotoType(contentType)) return Option.none<Picture>()
    const bytes = yield* Effect.tryPromise(() => object(piece.original_key))
    return bytes.byteLength <= mostPhotoBytes ? Option.some<Picture>({ bytes, contentType }) : Option.none<Picture>()
  }).pipe(Effect.orElseSucceed(() => Option.none<Picture>()))

const readOf = (piece: Stored) =>
  Effect.gen(function* () {
    const cutout = readPng(yield* Effect.tryPromise(() => object(piece.image_key)))
    if (Option.isNone(cutout)) return Option.none<Read>()
    const photo = yield* photoOf(piece)
    const answer = yield* askClef(runClef, CaptureMetrics.discarding, 'suggest', {
      model: 'clef-flash',
      state: Option.isSome(photo)
        ? 'The first image is one piece of sportswear cut out of a photo; the second is the photo it was cut from.'
        : 'One piece of sportswear cut out of a photo.',
      images: [imageOf(modelPicture(cutout.value, judgedAt)), ...Option.toArray(Option.map(photo, imageOf))],
      questions: sportQuestions,
    })
    return Option.some<Read>({
      id: piece.id,
      accountId: piece.account_id,
      withPhoto: Option.isSome(photo),
      ...sportRead(answer),
    })
  })

const pieces = await Schema.decodeUnknownPromise(Schema.Array(Stored))(
  await query(
    `SELECT id, account_id, image_key, original_key, content_type FROM pieces
       WHERE type = ? AND status = 'ready' AND image_key IS NOT NULL AND image_key <> original_key
         ${account === undefined ? '' : 'AND account_id = ?'}
       ORDER BY created_at`,
    account === undefined ? [from] : [from, account],
  ),
)

const reads = await readEach(pieces, readOf)
const moves = reads.filter((read) => read.to !== undefined)
const unsure = reads.filter((read) => read.to === undefined && (read.kind !== 'top' || read.probability < sportBar))

const report = values.out ?? `/tmp/retype-sport-${account ?? 'all'}.json`
await writeFile(report, JSON.stringify({ account: account ?? null, read: pieces.length, moves, unsure }, null, 2))
const movedTo = (type: PieceType) => moves.filter(({ to }) => to === type).length
console.log(
  `${pieces.length} sport tops read, ${reads.length} answered (${reads.filter(({ withPhoto }) => withPhoto).length} ` +
    `with their photo); ${movedTo('sportsBras')} move to sports bras, ${movedTo('sportBottoms')} to sport bottoms, ` +
    `${movedTo('tracksuits')} to tracksuits, ${unsure.length} left as they are on an unsure or not-sport answer. ` +
    `Report: ${report}`,
)

if (values.apply) {
  const at = Date.now()
  const written = await Promise.all(
    moves.flatMap(({ id, accountId, to }) =>
      to === undefined
        ? []
        : [
            query(
              `UPDATE pieces SET type = ?, updated_at = ? WHERE id = ? AND account_id = ? AND type = ? RETURNING id`,
              [to, at, id, accountId, from],
            ),
          ],
    ),
  )
  console.log(`${written.flat().length} of ${moves.length} moves written; any other piece was edited meanwhile.`)
}
