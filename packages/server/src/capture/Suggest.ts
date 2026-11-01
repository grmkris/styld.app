import { groupOf, PieceType } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { shownImage } from '../wardrobe/Shown.ts'
import type { PieceChanges, PieceRow } from '../wardrobe/Store.ts'
import { type Parts, readPixels, storedAs, unavailable } from './Parts.ts'
import { judgedAt } from './Pictures.ts'
import { modelPicture } from '@styld/imaging'
import { GarmentVision, type Suggestion } from './Providers.ts'
import { nowDate } from '../kernel/Db.ts'

// Pieces carried over from the old categories (owner, 2026-10-31) got the nearest garment type by migration and no
// attributes. The schedule's sweep asks the decision model about each once: its type is refined within the same group
// when the model is sure, and its season, occasions and pattern are filled where they are empty. A person's own
// choice is never overwritten: only pieces that were never suggested or confirmed (`suggested_at` is null) are asked.

/** How sure the model must be of the type's group before a carried-over type is replaced. */
const retypeAt = 0.6

/** How many pieces one sweep sends to the queue. */
const sweepBatch = 50

const isPieceType = Schema.is(PieceType)

/** What a suggestion changes on a carried-over piece: its type only within the same group and when the model is
 * sure, and only the attributes still empty. */
export const suggestedChanges = (
  piece: Pick<PieceRow, 'type' | 'season' | 'occasions' | 'pattern'>,
  suggestion: Suggestion,
): PieceChanges => {
  const current = Option.liftPredicate(piece.type, isPieceType)
  const type = Option.filter(
    Option.fromNullishOr(suggestion.type),
    (suggested) =>
      suggestion.confidence >= retypeAt && Option.exists(current, (carried) => groupOf(carried) === groupOf(suggested)),
  )
  return {
    ...Option.match(type, { onNone: () => ({}), onSome: (suggested) => ({ type: suggested }) }),
    ...(piece.season === null && suggestion.season !== undefined ? { season: suggestion.season } : {}),
    ...(piece.occasions.length === 0 ? { occasions: suggestion.occasions } : {}),
    ...(piece.pattern === null && suggestion.pattern !== undefined ? { pattern: suggestion.pattern } : {}),
  }
}

export const suggesting = (parts: Parts) => ({
  /** Ask the decision model about one carried-over piece, once. A piece shown only as a photo is left as it is. */
  suggestPiece: Effect.fn('Styld.Capture.suggestPiece')(function* (pieceId: string) {
    const found = yield* storedAs(parts.wardrobeStore.findPieceForProcessing(pieceId))
    if (Option.isNone(found) || found.value.suggestedAt !== null || found.value.status !== 'ready') return
    const piece = found.value
    const picture = Option.getOrUndefined(yield* storedAs(parts.store.findPicture(pieceId)))
    const pixels = yield* readPixels(parts, shownImage(piece, picture).key)
    const at = yield* nowDate
    if (Option.isNone(pixels)) {
      yield* storedAs(parts.wardrobeStore.updatePiece(piece.accountId, pieceId, { suggestedAt: at }))
      return
    }
    const suggestion = yield* (yield* GarmentVision)
      .suggest(modelPicture(pixels.value, judgedAt))
      .pipe(Effect.mapError(unavailable))
    yield* storedAs(
      parts.wardrobeStore.updatePiece(piece.accountId, pieceId, {
        ...suggestedChanges(piece, suggestion),
        suggestedAt: at,
      }),
    )
  }),
  /** The last attempt failed: the piece keeps its carried-over type, and is not asked about again. */
  failSuggestion: Effect.fn('Styld.Capture.failSuggestion')(function* (pieceId: string) {
    const found = yield* storedAs(parts.wardrobeStore.findPieceForProcessing(pieceId))
    if (Option.isNone(found) || found.value.suggestedAt !== null) return
    yield* storedAs(parts.wardrobeStore.updatePiece(found.value.accountId, pieceId, { suggestedAt: yield* nowDate }))
  }),
  /** The schedule's sweep: carried-over pieces go to the queue to be asked about, a batch at a time. */
  sweepSuggestions: Effect.fn('Styld.Capture.sweepSuggestions')(function* () {
    const pending = yield* storedAs(parts.wardrobeStore.piecesToSuggest(sweepBatch))
    yield* Effect.forEach(
      pending,
      (pieceId) =>
        Effect.tryPromise({
          try: () => parts.bindings.queue.send({ _tag: 'SuggestPiece', pieceId }),
          catch: unavailable,
        }),
      { discard: true },
    )
    return pending.length
  }),
})
