/**
 * Sorts the stored pieces of one type on a deployed stage into the types a question set names (Questions.ts), run by
 * hand once those types are deployed:
 *
 *   bun tools/once/retype.ts <sleeves|sport> --database <D1 name> --bucket <R2 bucket> [--account <id>]
 *     [--before <ISO time>] [--out <report.json>] [--apply]
 *
 * `sleeves` asks each short-sleeved top only about its sleeves (P4: long-sleeved or sleeveless); `sport` asks each
 * sport top which kind of sportswear it is (sports bras, sport bottoms or tracksuits), with the photo it was cut from
 * beside its cut-out when that photo is at most 4 MB, so a pair of leggings is read with the person wearing them.
 * Each ready piece of the set's type (of one account, or of every account without `--account`; made before `--before`
 * when given, so pieces sorted since are left alone) has its cut-out read from R2 and Clef asked through the Cloudflare
 * REST API as the Worker asks it. A piece moves only on an answer of another type at least `moveBar`; every other
 * answer leaves it as it is, and an unsure one is reported. Dry by default: the report lists what would move and what
 * Clef was unsure of, to check a sample against the pictures by eye. With `--apply` a move is written only while the
 * piece still has the set's type, so an edit made meanwhile wins. Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 * from the environment and never prints them; the report holds piece and account ids and answers only, and stays
 * outside Git.
 */
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { PieceType } from '@styld/protocol'
import { modelPicture, readPng } from '@styld/imaging'
import { pieces } from '@styld/db'
import { and, eq, isNotNull, lt, ne } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import type { Picture } from '../../packages/server/src/capture/Providers.ts'
import { judgedAt } from '../../packages/server/src/capture/Garments.ts'
import { CaptureMetrics } from '../../packages/server/src/kernel/Metrics.ts'
import { askClef, imageOf } from '../../packages/server/src/providers/Clef.ts'
import { built, cloudflareStage, readEach, stageOptions, statements } from '../CloudflareRest.ts'
import {
  isQuestionSetName,
  type QuestionRead,
  type QuestionSet,
  questionSets,
  questionsOf,
  readAnswer,
} from './Questions.ts'

const { values, positionals } = parseArgs({
  options: { ...stageOptions, before: { type: 'string' } },
  allowPositionals: true,
})
const token = process.env['CLOUDFLARE_API_TOKEN']
const cloudflareAccount = process.env['CLOUDFLARE_ACCOUNT_ID']
const { database, bucket, account } = values
const [setName] = positionals
const before = values.before === undefined ? undefined : Date.parse(values.before)
if (
  setName === undefined ||
  !isQuestionSetName(setName) ||
  token === undefined ||
  cloudflareAccount === undefined ||
  database === undefined ||
  bucket === undefined ||
  Number.isNaN(before)
)
  throw new Error(
    `Usage: bun tools/once/retype.ts <${Object.keys(questionSets).join('|')}> --database <D1 name> ` +
      '--bucket <R2 bucket> [--account <id>] [--before <ISO time>] [--out <file>] [--apply], with ' +
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set',
  )
const set: QuestionSet = questionSets[setName]

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

// The two statements, kept apart from the reading and the report.

/** The ready pieces of `from` with a cut-out of their own, of one account and made before a time when given. */
const statement = built(query)

const selectPieces = async (from: PieceType, filter: { readonly account?: string; readonly before?: number }) =>
  Schema.decodeUnknownPromise(Schema.Array(Stored))(
    await statement(
      statements
        .select({
          id: pieces.id,
          account_id: pieces.accountId,
          image_key: pieces.imageKey,
          original_key: pieces.originalKey,
          content_type: pieces.contentType,
        })
        .from(pieces)
        .where(
          and(
            eq(pieces.type, from),
            eq(pieces.status, 'ready'),
            isNotNull(pieces.imageKey),
            ne(pieces.imageKey, pieces.originalKey),
            filter.account === undefined ? undefined : eq(pieces.accountId, filter.account),
            filter.before === undefined ? undefined : lt(pieces.createdAt, new Date(filter.before)),
          ),
        )
        .orderBy(pieces.createdAt)
        .toSQL(),
    ),
  )

/** Moves one piece to `to` while it still has `from`; the ids it moved (none when it was edited meanwhile). */
const movePiece = async (
  move: { readonly id: string; readonly accountId: string },
  from: PieceType,
  to: PieceType,
  at: number,
) =>
  statement(
    statements
      .update(pieces)
      .set({ type: to, updatedAt: new Date(at) })
      .where(and(eq(pieces.id, move.id), eq(pieces.accountId, move.accountId), eq(pieces.type, from)))
      .returning({ id: pieces.id })
      .toSQL(),
  )

interface Read extends QuestionRead {
  readonly id: string
  readonly accountId: string
  /** Whether the photo was read beside the cut-out. */
  readonly withPhoto: boolean
}

const photoContentTypes: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp'])
const isPhotoType = (contentType: string): contentType is Picture['contentType'] => photoContentTypes.has(contentType)

/** The photo the piece was cut from, when the set sends one, Clef reads it and it is small enough to send. */
const photoOf = (piece: Stored) =>
  Effect.gen(function* () {
    const contentType = piece.content_type
    if (set.photoState === undefined || !isPhotoType(contentType)) return Option.none<Picture>()
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
      state: Option.isSome(photo) && set.photoState !== undefined ? set.photoState : set.state,
      images: [imageOf(modelPicture(cutout.value, judgedAt)), ...Option.toArray(Option.map(photo, imageOf))],
      questions: questionsOf(set),
    })
    return Option.some<Read>({
      id: piece.id,
      accountId: piece.account_id,
      withPhoto: Option.isSome(photo),
      ...readAnswer(set, answer),
    })
  })

const stored = await selectPieces(set.from, {
  ...(account === undefined ? {} : { account }),
  ...(before === undefined ? {} : { before }),
})
const reads = await readEach(stored, readOf)
const moves = reads.filter((read) => read.to !== undefined)
const unsure = reads.filter((read) => read.unsure)

const report = values.out ?? `/tmp/retype-${setName}-${account ?? 'all'}.json`
await writeFile(report, JSON.stringify({ account: account ?? null, read: stored.length, moves, unsure }, null, 2))
const targets = [...new Set(moves.flatMap(({ to }) => (to === undefined ? [] : [to])))]
const movedTo = targets.map((type) => `${moves.filter(({ to }) => to === type).length} to ${type}`).join(', ')
console.log(
  `${stored.length} ${set.pieces} read, ${reads.length} answered (${reads.filter(({ withPhoto }) => withPhoto).length} ` +
    `with their photo); ${moves.length} move (${movedTo || 'none'}), ${unsure.length} left as they are on an unsure ` +
    `answer. Report: ${report}`,
)

if (values.apply) {
  const at = Date.now()
  let written = 0
  for (const move of moves) if (move.to !== undefined) written += (await movePiece(move, set.from, move.to, at)).length
  console.log(`${written} of ${moves.length} moves written; any other piece was edited meanwhile.`)
}
