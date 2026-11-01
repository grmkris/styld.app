import { chromaKey, flatten, framed, keyColourFor, shrink } from '@styld/imaging'
import { Effect, Option, Schedule } from 'effect'
import { gateFor, planFor } from './CleanPicture.ts'
import { type Parts, pictureKey, readPixels, storedAs, unavailable, writeObject } from './Parts.ts'
import { decodePng, encodePng, opaqueShare, type Rgba } from './Pixels.ts'
import { CaptureMetrics } from './Metrics.ts'
import { CaptureConfig } from './Policy.ts'
import { GarmentVision, ImageGenerator, type Picture } from './Providers.ts'
import type { PictureRow, PictureState } from './Store.ts'
import { Holds, holdId } from '../usage/Holds.ts'
import { isStale } from '../wardrobe/Shown.ts'
import { nowDate } from '../kernel/Db.ts'

// What each provider sees: the decision model a 512 px copy, Muse a 1024 px one; the drawing is keyed at 1280 px,
// enough for the piece page at twice the pixel density, and about a million pixels of CPU.
export const judgedAt = 512
const drawnFrom = 1024
const keyedAt = 1280
// The room left around a keyed garment, as a share of its longer side.
const margin = 0.03

/** A PNG's pixels, or none for bytes that are not one. */
const decoded = (bytes: Uint8Array) => {
  try {
    return Option.some(decodePng(bytes))
  } catch {
    return Option.none<Rgba>()
  }
}

/** A stored cut-out's pixels: none when it is gone, or is a photo rather than a cut-out (no transparency), which
 * never leaves Styld. */
export const cutoutAt = (parts: Parts, key: string | null) =>
  key === null
    ? Effect.succeed(Option.none<Rgba>())
    : readPixels(parts, key).pipe(Effect.map(Option.filter((picture) => opaqueShare(picture) < 0.98)))

const asPng = (picture: Rgba): Picture => ({ bytes: encodePng(picture), contentType: 'image/png' })

/** A picture as a provider sees it: at most `longest` pixels, on light grey instead of transparency. */
export const sent = (picture: Rgba, longest: number) => asPng(flatten(shrink(picture, longest)))

const ends = ['ready', 'proposed', 'rejected', 'retake', 'kept-real', 'failed'] as const

/** Whether a picture has ended: shown, offered, dropped, sent for a retake, kept as its photo or failed. */
const hasEnded = (state: PictureState): state is (typeof ends)[number] => ends.some((end) => end === state)

/** Move a picture on from one of `from`; whether it moved. Every write goes through here, so two deliveries never
 * both act on one state, and each picture's end is counted once. */
const move = (
  parts: Parts,
  picture: Pick<PictureRow, 'pieceId' | 'provider' | 'paid'>,
  from: ReadonlyArray<PictureState>,
  changes: Partial<PictureRow>,
) =>
  Effect.gen(function* () {
    const { state } = changes
    const moved = yield* storedAs(
      parts.store.movePicture(picture.pieceId, from, { ...changes, updatedAt: yield* nowDate }),
    )
    // A drawing that shows, stops showing or is dropped changes what others see of a public piece.
    if (moved) yield* parts.pieceChanged.changed(picture.pieceId)
    if (!moved || state === undefined) return moved
    yield* Effect.annotateCurrentSpan('styld.picture.state', state)
    if (hasEnded(state))
      yield* (yield* CaptureMetrics).picture({
        state,
        provider: changes.provider ?? picture.provider ?? 'none',
        asked: picture.paid,
      })
    return moved
  })

const remove = (parts: Parts, key: string | null) =>
  key === null ? Effect.void : Effect.tryPromise({ try: () => parts.bindings.bucket.delete(key), catch: unavailable })

/** A drawing that cannot finish: the photo stays the piece's picture. */
const end = (parts: Parts, picture: PictureRow, from: PictureState, errorCode: string) =>
  move(parts, picture, [from], { state: 'failed', errorCode })

/** A stored drawing that cannot be checked ends, and its file goes. */
const endChecking = (parts: Parts, picture: PictureRow, errorCode: string) =>
  Effect.gen(function* () {
    if (yield* move(parts, picture, ['checking'], { state: 'failed', errorCode, cleanKey: null }))
      yield* remove(parts, picture.cleanKey)
  })

/** Ask the decision model how like the real cut-out the drawing is, and show it, offer it or drop it. */
const check = (parts: Parts, picture: PictureRow, drawn: Rgba, real: Rgba) =>
  Effect.gen(function* () {
    const policy = (yield* CaptureConfig).pictures
    const comparison = yield* (yield* GarmentVision).compare(sent(drawn, judgedAt), sent(real, judgedAt))
    const scores = { same: comparison.same, faithful: comparison.faithful }
    const gate = gateFor(comparison, policy)
    if (gate !== 'rejected') return yield* move(parts, picture, ['checking'], { ...scores, state: gate })
    if (yield* move(parts, picture, ['checking'], { ...scores, state: 'rejected', cleanKey: null }))
      yield* remove(parts, picture.cleanKey)
    return true
  })

/** Draw a claimed picture, key its background out and store it. Muse refusing ends it; Muse busy hands it back to
 * the queue; an answer lost on the way ends it as unknown, never drawn again. The stored drawing and the picture nowDate
 * checking it, or none when it ended. */
const draw = (parts: Parts, claimed: PictureRow, front: Rgba, back: Option.Option<Rgba>) =>
  Effect.gen(function* () {
    const { pieceId } = claimed
    const key = claimed.keyColour ?? 'green'
    const answer = yield* (yield* ImageGenerator)
      .draw({
        front: sent(front, drawnFrom),
        back: Option.map(back, (side) => sent(side, drawnFrom)),
        key,
        hint: Option.fromNullishOr(claimed.hint),
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag('ProviderOutcomeUnknown', () =>
          Effect.as(end(parts, claimed, 'generating', 'unknown'), Option.none<Picture>()),
        ),
        Effect.catchTag('ProviderFailed', (error) =>
          error.retryable
            ? Effect.andThen(
                move(parts, claimed, ['generating'], {
                  state: 'queued',
                  version: claimed.version - 1,
                  claimedAt: null,
                }),
                Effect.fail(error),
              )
            : Effect.as(end(parts, claimed, 'generating', 'refused'), Option.none<Picture>()),
        ),
      )
    const ended = Option.none<{ readonly clean: Rgba; readonly checking: PictureRow }>()
    if (Option.isNone(answer)) return ended
    const keyed = Option.flatMap(decoded(answer.value.bytes), (drawn) => chromaKey(shrink(drawn, keyedAt), key))
    if (Option.isNone(keyed)) {
      yield* end(parts, claimed, 'generating', 'key')
      return ended
    }
    const clean = framed(keyed.value, margin)
    const cleanKey = pictureKey(claimed.accountId, pieceId, claimed.version)
    const written = yield* writeObject(parts, cleanKey, encodePng(clean), 'image/png').pipe(
      Effect.retry({ times: 2, schedule: Schedule.exponential('200 millis') }),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!written) {
      yield* end(parts, claimed, 'generating', 'unavailable')
      return ended
    }
    // A delivery that gave up on the picture meanwhile has ended it; its drawing goes.
    if (!(yield* move(parts, claimed, ['generating'], { state: 'checking', cleanKey }))) {
      yield* remove(parts, cleanKey)
      return ended
    }
    return Option.some({ clean, checking: { ...claimed, state: 'checking' as const, cleanKey } })
  })

/** A queued picture: judge the cut-out, then keep the photo (a face may show), ask for a retake (a fragment), or claim
 * and draw it. A redraw the owner asked for (it holds a credit) is drawn whatever the verdict, unless a face may show.
 * The claim drops the last drawing: a redraw replaces it. */
const start = (parts: Parts, picture: PictureRow) =>
  Effect.gen(function* () {
    const policy = (yield* CaptureConfig).pictures
    const { pieceId } = picture
    const piece = yield* storedAs(parts.wardrobeStore.findPiece(picture.accountId, pieceId))
    if (Option.isNone(piece)) return
    const front = yield* cutoutAt(parts, piece.value.imageKey)
    if (Option.isNone(front)) return yield* move(parts, picture, ['queued'], { state: 'kept-real' })
    const judgement = yield* (yield* GarmentVision).judge(sent(front.value, judgedAt))
    const judged = { judge: judgement.verdict, judgeConfidence: judgement.confidence, face: judgement.face }
    const asked = picture.paid && judgement.face < policy.face
    const { plan } = asked ? { plan: 'draw' as const } : planFor(judgement, policy)
    if (plan !== 'draw') return yield* move(parts, picture, ['queued'], { ...judged, state: plan })
    const generator = yield* ImageGenerator
    const claim = {
      ...judged,
      state: 'generating' as const,
      version: picture.version + 1,
      keyColour: keyColourFor(front.value),
      provider: generator.provider,
      model: generator.model,
      claimedAt: yield* nowDate,
      cleanKey: null,
      errorCode: null,
    }
    if (!(yield* move(parts, picture, ['queued'], claim))) return
    yield* remove(parts, picture.cleanKey)
    const back = yield* cutoutAt(parts, piece.value.backImageKey)
    const drawn = yield* draw(parts, { ...picture, ...claim }, front.value, back)
    if (Option.isSome(drawn)) yield* check(parts, drawn.value.checking, drawn.value.clean, front.value)
  })

/** A drawing stored before its check finished: read both pictures back and check it. */
const checkStored = (parts: Parts, picture: PictureRow) =>
  Effect.gen(function* () {
    const piece = yield* storedAs(parts.wardrobeStore.findPiece(picture.accountId, picture.pieceId))
    const drawn = picture.cleanKey === null ? Option.none<Rgba>() : yield* cutoutAt(parts, picture.cleanKey)
    const real = Option.isNone(piece) ? Option.none<Rgba>() : yield* cutoutAt(parts, piece.value.imageKey)
    if (Option.isNone(drawn) || Option.isNone(real)) return yield* endChecking(parts, picture, 'missing')
    yield* check(parts, picture, drawn.value, real.value)
  })

/** The hold paying for a piece's latest redraw. */
export const redrawHold = (picture: Pick<PictureRow, 'pieceId' | 'redraws'>) =>
  holdId('picture', picture.pieceId, picture.redraws)

/** A redraw's credit, once its drawing ended: consumed for a drawing the owner can see, refunded otherwise. The first
 * settlement stands, so whoever comes next settles a hold a delivery left, and settling again is safe. */
export const settleHold = (parts: Parts, pieceId: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isNone(found) || !found.value.paid || !hasEnded(found.value.state)) return
    const { accountId, state } = found.value
    yield* (yield* Holds).settle(
      accountId,
      redrawHold(found.value),
      state === 'ready' || state === 'proposed' ? 'succeeded' : 'failed',
    )
  })

/** The queue side of clean pictures. */
export const picturing = (parts: Parts) => ({
  /** Carry a piece's clean picture as far as it goes. A drawing claimed by a delivery still within its patience is
   * left to it; a finished one only has a redraw's credit settled. */
  processPicture: Effect.fn('Styld.Picture.process')(function* (pieceId: string) {
    const found = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isNone(found)) return
    const picture = found.value
    if (!(yield* storedAs(parts.wardrobeStore.accountEnabled(picture.accountId)))) return
    if (picture.state === 'queued') yield* start(parts, picture)
    else if (picture.state === 'checking') yield* checkStored(parts, picture)
    else if (isStale(picture, yield* nowDate)) yield* end(parts, picture, 'generating', 'unknown')
    yield* settleHold(parts, pieceId)
  }),
  /** The last attempt failed: the photo stays. A drawing that may have been made counts as unknown. */
  failPicture: Effect.fn('Styld.Picture.fail')(function* (pieceId: string) {
    const found = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isNone(found)) return
    const picture = found.value
    if (picture.state === 'queued') yield* end(parts, picture, 'queued', 'gave-up')
    else if (picture.state === 'generating') yield* end(parts, picture, 'generating', 'unknown')
    else if (picture.state === 'checking') yield* endChecking(parts, picture, 'gave-up')
    yield* settleHold(parts, pieceId)
  }),
})
