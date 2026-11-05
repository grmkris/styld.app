import { ProviderError } from '../providers/Errors.ts'
import {
  chromaKey,
  encodePng,
  framed,
  keyColourFor,
  modelPicture,
  readPng,
  type Rgba,
  shrink,
  turned,
} from '@styld/imaging'
import { Effect, Option, Schedule } from 'effect'
import { readObject, readPixels, writeObject } from './Shared.ts'
import { opaqueShare } from './Pixels.ts'
import { type DrawRequest, type GarmentVision, ImageGenerator, type Picture, PictureWork } from './Providers.ts'
import type { PictureRow } from './Store.ts'
import { hasEnded, type PictureState } from './PictureLifecycle.ts'
import type { PieceRow } from '../wardrobe/Store.ts'
import { isStale } from '../wardrobe/Shown.ts'
import { nowDate, stored } from '../kernel/Db.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Media } from '../kernel/Media.ts'
import { CaptureMetrics, type PictureOutcome } from '../kernel/Metrics.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { called } from '../kernel/Bindings.ts'

// One drawing lifecycle for either side of a piece (owner, 4 November 2026: a pressed back, drawn only from a real
// one, beside the front's clean picture): plan, claim, draw with the image model, key the background out, store and
// show. A drawing is not checked against its cut-out (owner, 4 November: `Policy.ts` › `pictures`); the person's photo
// is one swipe away. `piece_pictures` and `piece_back_pictures` share the columns it
// reads and writes; what differs per side (its rows, its file, its cut-outs, when to draw, a redraw's credit) is its
// `Slot`.

// What Muse sees: a 1024 px copy; the drawing is keyed at
// 1280 px, enough for the piece page at twice the pixel density, and about a million pixels of CPU.
const drawnFrom = 1024
const keyedAt = 1280
// The room left around a keyed garment, as a share of its longer side.
const margin = 0.03

/** The columns a drawing of either side shares. */
export type Drawing = Pick<
  PictureRow,
  'pieceId' | 'accountId' | 'state' | 'cleanKey' | 'version' | 'keyColour' | 'provider' | 'claimedAt'
>
type Changes = Partial<Omit<Drawing, 'pieceId' | 'accountId' | 'state'>> & {
  readonly updatedAt?: Date
  readonly drawnRotation?: PictureRow['drawnRotation']
}

/** What a side of a piece brings to its drawing. */
export interface Slot<Row extends Drawing, E, R> {
  /** The side the picture shows. */
  readonly side: 'front' | 'back'
  /** How its end is counted (`CaptureMetrics.picture`). */
  readonly kind: (row: Row) => PictureOutcome['kind']
  readonly find: (pieceId: string) => Effect.Effect<Option.Option<Row>, E, R>
  /** Move it from one of `from` to `to` (`PictureLifecycle.ts`); whether it moved. */
  readonly write: (
    pieceId: string,
    from: ReadonlyArray<PictureState>,
    to: PictureState,
    changes: Changes,
  ) => Effect.Effect<boolean, E, R>
  /** Where a version of its drawing is stored. */
  readonly keyOf: (row: Row, version: number) => string
  /** The cut-out it is drawn from, and the piece's other side, for reference. */
  readonly cutouts: (
    piece: PieceRow,
  ) => Effect.Effect<{ readonly subject: Option.Option<Rgba>; readonly other: Option.Option<Rgba> }, E, R>
  /** What its claim records of the piece it is drawn from: the front, the rotation its cut-out is turned by. */
  readonly drawnWith: (piece: PieceRow) => Pick<Changes, 'drawnRotation'>
  /** Whether to draw it from its cut-out, or ask for a retake. */
  readonly plan: (row: Row, subject: Rgba) => Effect.Effect<'draw' | 'retake', ProviderError, GarmentVision>
  /** The photo the side's cut-out came from, asked for only once Muse refused the cut-out alone (`photoOf`). */
  readonly photo: (piece: PieceRow) => Effect.Effect<Option.Option<Rgba>, never, R>
  readonly hint: (row: Row) => Option.Option<string>
  /** After each delivery, whatever it did: a redraw's credit settled. */
  readonly after: (pieceId: string) => Effect.Effect<void, E, R>
}

/** A stored cut-out's pixels: none when it is gone, or is a photo rather than a cut-out (no transparency), which
 * never leaves Styld. */
export const cutoutAt = (key: string | null) =>
  key === null
    ? Effect.succeed(Option.none<Rgba>())
    : readPixels(key).pipe(Effect.map(Option.filter((picture) => opaqueShare(picture) < 0.98)))

/** A piece's front cut-out as its owner sees it: turned by the rotation they set, so Clef judges and Muse draws the
 * garment upright. An upside-down skirt was once judged and drawn as it was stored (Eva, 4 November). Its back is a
 * photo of its own, never turned by the front's rotation. */
export const frontOf = (piece: Pick<PieceRow, 'imageKey' | 'rotation'>) =>
  Effect.map(
    cutoutAt(piece.imageKey),
    Option.map((front) => turned(front, piece.rotation)),
  )

/** A piece's photo as Muse may see it once it refused the cut-out alone: Styld's working copy (orientation applied,
 * metadata gone), turned as its cut-out is. None when the cut-out is the photo itself, or the photo cannot be read or
 * re-encoded: the drawing then fails as a refusal does. */
export const photoOf = (piece: Pick<PieceRow, 'originalKey' | 'imageKey' | 'rotation'>) =>
  piece.originalKey === piece.imageKey
    ? Effect.succeed(Option.none<Rgba>())
    : readObject(piece.originalKey).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none<Rgba>()),
            onSome: (original) =>
              Effect.map(
                Effect.flatMap(PictureWork, (work) => work.workingCopies(original)),
                ({ png }) => Option.map(readPng(png), (photo) => turned(photo, piece.rotation)),
              ),
          }),
        ),
        Effect.orElseSucceed(() => Option.none<Rgba>()),
      )

export const removeObject = (key: string | null) =>
  key === null ? Effect.void : Effect.flatMap(Media, ({ bucket }) => called(() => bucket.delete(key)))

/** Move a drawing from one of `from` to `to`; whether it moved. Every write of the job goes through here, so two
 * deliveries never both act on one state, and each drawing's end is counted once. */
const move = <Row extends Drawing, E, R>(
  slot: Slot<Row, E, R>,
  row: Row,
  from: ReadonlyArray<PictureState>,
  to: PictureState,
  changes: Changes = {},
) =>
  Effect.gen(function* () {
    const moved = yield* slot.write(row.pieceId, from, to, { ...changes, updatedAt: yield* nowDate })
    // A drawing that shows, stops showing or is dropped changes what others see of a public piece.
    if (moved) yield* (yield* PieceChanged).changed(row.pieceId)
    if (!moved) return moved
    yield* Effect.annotateCurrentSpan({ 'styld.picture.state': to, 'styld.picture.side': slot.side })
    if (hasEnded(to))
      yield* (yield* CaptureMetrics).picture({
        state: to,
        provider: changes.provider ?? row.provider ?? 'none',
        kind: slot.kind(row),
      })
    return moved
  })

/** A drawing that cannot finish: the photo stays the piece's picture. Why is on the span, not in the row. */
const end = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, row: Row, from: PictureState, why: string) =>
  Effect.andThen(Effect.annotateCurrentSpan('styld.picture.failed', why), move(slot, row, [from], 'failed'))

/** A drawing claimed for drawing: its row, its piece, the cut-out it is drawn from and the piece's other side. */
interface Claimed<Row extends Drawing> {
  readonly claimed: Row
  readonly piece: PieceRow
  readonly subject: Rgba
  readonly other: Option.Option<Rgba>
}

/** Ask the image model for a claimed drawing. Muse refusing the cut-out alone asks once more with the piece's photo
 * first and the cut-out second, the garment to draw from it named (owner, 4 November: the spike's variant C drew a
 * bodysuit Muse had refused from its cut-out); a second refusal, or no photo, ends it. Both asks are one drawing, so a
 * redraw holds one credit. Muse busy hands it back to the queue; an answer lost on the way ends it as unknown, never
 * drawn again. The picture, or none when it ended. */
const ask = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, { claimed, piece, subject, other }: Claimed<Row>) =>
  Effect.gen(function* () {
    const generator = yield* ImageGenerator
    const refused = () => Effect.as(end(slot, claimed, 'generating', 'refused'), Option.none<Picture>())
    const asked = <E2, R2>(request: DrawRequest, onRefused: () => Effect.Effect<Option.Option<Picture>, E2, R2>) =>
      generator.draw(request).pipe(
        Effect.map(Option.some),
        Effect.catchReasons('ProviderError', {
          OutcomeUnknown: () => Effect.as(end(slot, claimed, 'generating', 'unknown'), Option.none<Picture>()),
          // Busy: the claim goes back for the queue's next try.
          Busy: (reason) =>
            Effect.andThen(
              move(slot, claimed, ['generating'], 'queued', { version: claimed.version - 1, claimedAt: null }),
              Effect.fail(ProviderError.make({ provider: 'meta-muse', reason })),
            ),
          Refused: onRefused,
          Broken: refused,
        }),
      )
    const request: DrawRequest = {
      side: slot.side,
      subject: modelPicture(subject, drawnFrom),
      other: Option.map(other, (side) => modelPicture(side, drawnFrom)),
      photo: Option.none(),
      type: piece.type,
      colours: piece.colours,
      key: claimed.keyColour ?? 'green',
      hint: slot.hint(claimed),
    }
    return yield* asked(request, () =>
      Effect.gen(function* () {
        const photo = yield* slot.photo(piece)
        if (Option.isNone(photo)) return yield* refused()
        yield* Effect.annotateCurrentSpan('styld.picture.fromPhoto', true)
        const fromPhoto = { ...request, other: Option.none(), photo: Option.some(modelPicture(photo.value, drawnFrom)) }
        return yield* asked(fromPhoto, refused)
      }),
    )
  })

/** Draw a claimed drawing, key its background out, store it and show it. */
const draw = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, job: Claimed<Row>) =>
  Effect.gen(function* () {
    const { claimed } = job
    const answer = yield* ask(slot, job)
    if (Option.isNone(answer)) return
    const key = claimed.keyColour ?? 'green'
    const keyed = Option.flatMap(readPng(answer.value.bytes), (drawn) => chromaKey(shrink(drawn, keyedAt), key))
    if (Option.isNone(keyed)) return yield* end(slot, claimed, 'generating', 'key')
    const cleanKey = slot.keyOf(claimed, claimed.version)
    const written = yield* writeObject(cleanKey, encodePng(framed(keyed.value, margin)), 'image/png').pipe(
      Effect.retry({ times: 2, schedule: Schedule.exponential('200 millis') }),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!written) return yield* end(slot, claimed, 'generating', 'unavailable')
    // A delivery that gave up on the drawing meanwhile has ended it; its drawing goes.
    if (!(yield* move(slot, claimed, ['generating'], 'ready', { cleanKey }))) yield* removeObject(cleanKey)
  })

/** A queued drawing: keep the photo when there is no cut-out, ask for a retake when the side's plan says so, or claim
 * and draw it. The claim drops the last drawing: a redraw replaces it. */
const start = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, row: Row) =>
  Effect.gen(function* () {
    const piece = yield* stored((yield* WardrobeStore).findPiece(row.accountId, row.pieceId))
    if (Option.isNone(piece)) return
    const { subject, other } = yield* slot.cutouts(piece.value)
    if (Option.isNone(subject)) return yield* move(slot, row, ['queued'], 'kept-real')
    if ((yield* slot.plan(row, subject.value)) === 'retake') return yield* move(slot, row, ['queued'], 'retake')
    const claim = {
      version: row.version + 1,
      keyColour: keyColourFor(subject.value),
      provider: (yield* ImageGenerator).provider,
      claimedAt: yield* nowDate,
      cleanKey: null,
      ...slot.drawnWith(piece.value),
    }
    if (!(yield* move(slot, row, ['queued'], 'generating', claim))) return
    yield* removeObject(row.cleanKey)
    yield* draw(slot, {
      claimed: { ...row, ...claim, state: 'generating' },
      piece: piece.value,
      subject: subject.value,
      other,
    })
  })

/** A side's drawing, from its queued state to its end. */
export const drawingOf = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>) => ({
  /** Carry a piece's drawing as far as it goes. A drawing claimed by a delivery still within its patience is left to
   * it. */
  process: (pieceId: string) =>
    Effect.gen(function* () {
      const found = yield* slot.find(pieceId)
      if (Option.isNone(found)) return
      const row = found.value
      if (!(yield* stored((yield* WardrobeStore).accountEnabled(row.accountId)))) return
      if (row.state === 'queued') yield* start(slot, row)
      else if (isStale(row, yield* nowDate)) yield* end(slot, row, 'generating', 'unknown')
      yield* slot.after(pieceId)
    }),
  /** The last attempt failed: the photo stays. A drawing that may have been made counts as unknown. */
  fail: (pieceId: string) =>
    Effect.gen(function* () {
      const found = yield* slot.find(pieceId)
      if (Option.isNone(found)) return
      const row = found.value
      if (row.state === 'queued') yield* end(slot, row, 'queued', 'gave-up')
      else if (row.state === 'generating') yield* end(slot, row, 'generating', 'unknown')
      yield* slot.after(pieceId)
    }),
})
