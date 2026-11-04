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
import { judgedAt } from './Garments.ts'
import { readPixels, storedAs, unavailable, writeObject } from './Shared.ts'
import { opaqueShare } from './Pixels.ts'
import { GarmentVision, ImageGenerator, type Judgement, type Picture } from './Providers.ts'
import type { PictureRow, PictureState } from './Store.ts'
import type { PieceRow } from '../wardrobe/Store.ts'
import { isStale } from '../wardrobe/Shown.ts'
import { nowDate } from '../kernel/Db.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Media } from '../kernel/Media.ts'
import { CaptureMetrics, type PictureOutcome } from '../kernel/Metrics.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'

// One drawing lifecycle for either side of a piece (owner, 4 November 2026: a pressed back, drawn only from a real
// one, beside the front's clean picture): plan, claim, draw with the image model, key the background out, store and
// show. A drawing is not checked against its cut-out (owner, 4 November: `Policy.ts` › `pictures`); the person's photo
// is one swipe away. `piece_pictures` and `piece_back_pictures` share the columns it
// reads and writes; what differs per side (its rows, its file, its cut-outs, when to draw, a redraw's credit) is its
// `Slot`.

// What each provider sees: the decision model a 512 px copy (`judgedAt`), Muse a 1024 px one; the drawing is keyed at
// 1280 px, enough for the piece page at twice the pixel density, and about a million pixels of CPU.
const drawnFrom = 1024
const keyedAt = 1280
// The room left around a keyed garment, as a share of its longer side.
const margin = 0.03

/** The columns a drawing of either side shares. */
export type Drawing = Pick<
  PictureRow,
  'pieceId' | 'accountId' | 'state' | 'cleanKey' | 'version' | 'keyColour' | 'provider' | 'face' | 'claimedAt'
>
type Changes = Partial<Omit<Drawing, 'pieceId' | 'accountId'>> & { readonly updatedAt?: Date }

/** What a side of a piece brings to its drawing. */
export interface Slot<Row extends Drawing, E, R> {
  /** The side the picture shows. */
  readonly side: 'front' | 'back'
  /** How its end is counted (`CaptureMetrics.picture`). */
  readonly kind: (row: Row) => PictureOutcome['kind']
  readonly find: (pieceId: string) => Effect.Effect<Option.Option<Row>, E, R>
  /** Move it on from one of `from`; whether it moved. */
  readonly write: (pieceId: string, from: ReadonlyArray<PictureState>, changes: Changes) => Effect.Effect<boolean, E, R>
  /** Where a version of its drawing is stored. */
  readonly keyOf: (row: Row, version: number) => string
  /** The cut-out it is drawn from and checked against, and the piece's other side, for reference. */
  readonly cutouts: (
    piece: PieceRow,
  ) => Effect.Effect<{ readonly subject: Option.Option<Rgba>; readonly other: Option.Option<Rgba> }, E, R>
  /** Whether to draw it, from the decision model's judgement of the cut-out: or keep the photo, or ask for a retake. */
  readonly plan: (row: Row, judgement: Judgement) => 'draw' | 'kept-real' | 'retake'
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

const ends = ['ready', 'proposed', 'rejected', 'retake', 'kept-real', 'failed'] as const

/** Whether a drawing has ended: shown, offered, dropped, sent for a retake, kept as its photo or failed. */
export const hasEnded = (state: PictureState): state is (typeof ends)[number] => ends.some((end) => end === state)

export const removeObject = (key: string | null) =>
  key === null
    ? Effect.void
    : Effect.flatMap(Media, ({ bucket }) => Effect.tryPromise({ try: () => bucket.delete(key), catch: unavailable }))

/** Move a drawing on from one of `from`; whether it moved. Every write goes through here, so two deliveries never both
 * act on one state, and each drawing's end is counted once. */
const move = <Row extends Drawing, E, R>(
  slot: Slot<Row, E, R>,
  row: Row,
  from: ReadonlyArray<PictureState>,
  changes: Changes,
) =>
  Effect.gen(function* () {
    const { state } = changes
    const moved = yield* slot.write(row.pieceId, from, { ...changes, updatedAt: yield* nowDate })
    // A drawing that shows, stops showing or is dropped changes what others see of a public piece.
    if (moved) yield* (yield* PieceChanged).changed(row.pieceId)
    if (!moved || state === undefined) return moved
    yield* Effect.annotateCurrentSpan({ 'styld.picture.state': state, 'styld.picture.side': slot.side })
    if (hasEnded(state))
      yield* (yield* CaptureMetrics).picture({
        state,
        provider: changes.provider ?? row.provider ?? 'none',
        kind: slot.kind(row),
      })
    return moved
  })

/** A drawing that cannot finish: the photo stays the piece's picture. Why is on the span, not in the row. */
const end = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, row: Row, from: PictureState, why: string) =>
  Effect.andThen(Effect.annotateCurrentSpan('styld.picture.failed', why), move(slot, row, [from], { state: 'failed' }))

/** A drawing stored before 4 November's release, still waiting for the check it no longer gets: shown, as one stored
 * now is. */
const showStored = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, row: Row) =>
  move(slot, row, ['checking'], { state: row.cleanKey === null ? 'failed' : 'ready' })

/** Ask the image model for a claimed drawing. Muse refusing ends it; Muse busy hands it back to the queue; an answer
 * lost on the way ends it as unknown, never drawn again. The picture, or none when it ended. */
const ask = <Row extends Drawing, E, R>(
  slot: Slot<Row, E, R>,
  claimed: Row,
  subject: Rgba,
  other: Option.Option<Rgba>,
) =>
  Effect.flatMap(ImageGenerator, (generator) =>
    generator
      .draw({
        side: slot.side,
        subject: modelPicture(subject, drawnFrom),
        other: Option.map(other, (side) => modelPicture(side, drawnFrom)),
        key: claimed.keyColour ?? 'green',
        hint: slot.hint(claimed),
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchReasons('ProviderError', {
          OutcomeUnknown: () => Effect.as(end(slot, claimed, 'generating', 'unknown'), Option.none<Picture>()),
          // Busy: the claim goes back for the queue's next try.
          Busy: (reason) =>
            Effect.andThen(
              move(slot, claimed, ['generating'], { state: 'queued', version: claimed.version - 1, claimedAt: null }),
              Effect.fail(ProviderError.make({ provider: 'meta-muse', reason })),
            ),
          Refused: () => Effect.as(end(slot, claimed, 'generating', 'refused'), Option.none<Picture>()),
          Broken: () => Effect.as(end(slot, claimed, 'generating', 'refused'), Option.none<Picture>()),
        }),
      ),
  )

/** Draw a claimed drawing, key its background out, store it and show it. */
const draw = <Row extends Drawing, E, R>(
  slot: Slot<Row, E, R>,
  claimed: Row,
  subject: Rgba,
  other: Option.Option<Rgba>,
) =>
  Effect.gen(function* () {
    const answer = yield* ask(slot, claimed, subject, other)
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
    if (!(yield* move(slot, claimed, ['generating'], { state: 'ready', cleanKey }))) yield* removeObject(cleanKey)
  })

/** A queued drawing: judge the cut-out, then keep the photo (a face may show), ask for a retake (a fragment), or claim
 * and draw it. The claim drops the last drawing: a redraw replaces it. */
const start = <Row extends Drawing, E, R>(slot: Slot<Row, E, R>, row: Row) =>
  Effect.gen(function* () {
    const piece = yield* storedAs((yield* WardrobeStore).findPiece(row.accountId, row.pieceId))
    if (Option.isNone(piece)) return
    const { subject, other } = yield* slot.cutouts(piece.value)
    if (Option.isNone(subject)) return yield* move(slot, row, ['queued'], { state: 'kept-real' })
    const judgement = yield* (yield* GarmentVision).judge(modelPicture(subject.value, judgedAt))
    yield* Effect.annotateCurrentSpan('styld.picture.verdict', judgement.verdict)
    const judged = { face: judgement.face }
    const plan = slot.plan(row, judgement)
    if (plan !== 'draw') return yield* move(slot, row, ['queued'], { ...judged, state: plan })
    const claim = {
      ...judged,
      state: 'generating' as const,
      version: row.version + 1,
      keyColour: keyColourFor(subject.value),
      provider: (yield* ImageGenerator).provider,
      claimedAt: yield* nowDate,
      cleanKey: null,
    }
    if (!(yield* move(slot, row, ['queued'], claim))) return
    yield* removeObject(row.cleanKey)
    yield* draw(slot, { ...row, ...claim }, subject.value, other)
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
      if (!(yield* storedAs((yield* WardrobeStore).accountEnabled(row.accountId)))) return
      if (row.state === 'queued') yield* start(slot, row)
      else if (row.state === 'checking') yield* showStored(slot, row)
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
      else if (row.state === 'checking') yield* showStored(slot, row)
      yield* slot.after(pieceId)
    }),
})
