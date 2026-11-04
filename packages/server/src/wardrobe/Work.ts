import { familyOf } from '@styld/protocol'
import { DateTime, Duration, Effect, Option } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { deleteKeys, Media } from '../kernel/Media.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { PaidAttempts } from '../usage/Attempts.ts'
import { stored, typeOf, type WardrobeServices } from './Shared.ts'
import { GarmentCutout, type PieceDescription } from './Processing.ts'
import { type PieceRow, WardrobeStore } from './Store.ts'

/** Bytes received but used by nothing are kept this long after their upload path expired. */
const unusedPatience = Duration.days(1)

/** The most uploads of each kind (paths never used, bytes never used) one sweep forgets: 1,000 every ten minutes, well
 * above what the upload pace and the waiting cap let accounts leave behind (`Wardrobe.ts`). */
const uploadBatch = 500

/** How sure the decision model must be of a type's group to change an imported piece's type to it. */
const typeConfidence = 0.75

/** An imported piece's details as the decision model describes them: its type when the model is sure of the group or
 * the type stays in the mapped one's group, v1's colours unless it had none, and the seasons, Rainproof, occasions and
 * pattern v1 never had. A house garment the seed generated keeps the type it was generated as (owner, 4 November
 * 2026): its picture was judged to be that type before it was imported.
 * @internal Exported for its tests. */
export const importedDetails = (
  row: Pick<PieceRow, 'type' | 'colours'>,
  found: PieceDescription,
  generated = false,
) => ({
  ...(!generated &&
  found.type !== undefined &&
  (found.confidence >= typeConfidence || familyOf(found.type) === familyOf(row.type))
    ? { type: found.type }
    : {}),
  ...(row.colours.length === 0 && found.colours.length > 0 ? { colours: found.colours } : {}),
  seasons: found.seasons,
  rainproof: found.rainproof,
  occasions: found.occasions,
  pattern: found.pattern ?? null,
})

/** A processed piece made ready with its image. A piece brought over from v1 is described by the decision model as it
 * is imported: v1's categories and colour words are only where it starts (no sweep suggests attributes later). A house
 * garment the seed generated keeps its type, and what the model read is kept for the operator's report. */
const finished = Effect.fnUntraced(function* (row: PieceRow, imageKey: string) {
  const store = yield* WardrobeStore
  const imported = row.source === 'import'
  const cutOut = imported && imageKey !== row.originalKey
  const described = cutOut ? yield* (yield* GarmentCutout).describe(imageKey, row.originalKey) : Option.none()
  const generated = imported && (yield* stored(store.generatedAmong([row.id]))).has(row.id)
  const at = yield* nowDate
  const details = Option.match(described, {
    onNone: () => ({}),
    onSome: (found) => importedDetails(row, found, generated),
  })
  yield* stored(store.finishProcessing(row.id, { status: 'ready', imageKey, ...details, updatedAt: at }))
  if (generated && Option.isSome(described))
    yield* stored(store.describedGenerated(row.id, described.value.type ?? null, described.value.whole, at))
})

/** A piece's work on the queue, and the sweep of uploads nothing used. */
export const processing = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  /** Run the cut-out step for a piece the queue delivered. Finished pieces are left alone, and so is one whose cut-out
   * another delivery is making. */
  processPiece: Effect.fn('Styld.Wardrobe.processPiece')(function* (pieceId: string) {
    const store = yield* WardrobeStore
    const row = yield* stored(store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    if (!(yield* stored(store.accountEnabled(row.value.accountId)))) return
    const type = yield* typeOf(row.value)
    const imported = row.value.source === 'import'
    const cutout = yield* GarmentCutout
    const cut = yield* cutout
      .cut({
        accountId: row.value.accountId,
        pieceId,
        originalKey: row.value.originalKey,
        contentType: row.value.contentType,
        type,
        of: { side: 'front', payer: imported ? 'styld' : 'account' },
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag('AttemptElsewhere', () => Effect.succeedNone),
      )
    if (Option.isNone(cut)) return
    yield* finished(row.value, cut.value.imageKey)
    yield* (yield* PieceChanged).changed(pieceId)
  }, Effect.provide(context)),
  /** The queue or the sweep gave up on a piece: it shows as failed rather than processing forever, and a credit a
   * delivery that died still held comes back. */
  failPiece: Effect.fn('Styld.Wardrobe.failPiece')(function* (pieceId: string) {
    const store = yield* WardrobeStore
    const row = yield* stored(store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    // The refund is recorded before the piece leaves processing, so it is not lost with the status that found it.
    yield* (yield* PaidAttempts).abandon(`piece/${pieceId}`, row.value.accountId)
    yield* stored(store.finishProcessing(pieceId, { status: 'failed', imageKey: null, updatedAt: yield* nowDate }))
  }, Effect.provide(context)),
  /** The sweep of uploads nothing used: their rows, then the bytes of those forgotten (an upload used meanwhile keeps
   * both). */
  sweepUploads: Effect.fn('Styld.Wardrobe.sweepUploads')(function* () {
    const store = yield* WardrobeStore
    const now = yield* DateTime.now
    const expired = yield* stored(store.unusedUploads('pending', DateTime.toDateUtc(now), uploadBatch))
    const received = DateTime.toDateUtc(DateTime.subtractDuration(now, unusedPatience))
    const unused = yield* stored(store.unusedUploads('received', received, uploadBatch))
    const forgotten = yield* stored(store.forgetUploads([...expired, ...unused]))
    yield* deleteKeys((yield* Media).bucket, forgotten)
    return forgotten.length
  }, Effect.provide(context)),
}))
