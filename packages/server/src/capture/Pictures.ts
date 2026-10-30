import { chromaKey, flatten, keyColourFor, shrink } from '@styld/imaging'
import { DateTime, Effect, Option, Schedule } from 'effect'
import { gateFor, planFor } from './CleanPicture.ts'
import { type Parts, pictureKey, readObject, storedAs, unavailable, writeObject } from './Parts.ts'
import { crop, decodePng, encodePng, opaqueBounds, opaqueShare, type Rgba } from './Pixels.ts'
import { CaptureConfig } from './Policy.ts'
import { GarmentVision, ImageGenerator, type Picture } from './Providers.ts'
import type { PictureRow, PictureState } from './Store.ts'

const now = Effect.map(DateTime.now, DateTime.toDateUtc)

// What each provider sees: the decision model a 512 px copy, Muse a 1024 px one; the drawing is keyed at 1280 px,
// enough for the piece page at twice the pixel density, and about a million pixels of CPU.
const judgedAt = 512
const drawnFrom = 1024
const keyedAt = 1280
// The room left around a keyed garment, as a share of its longer side.
const margin = 0.03
// A claim older than Muse's 90 s timeout plus the keying belongs to a delivery that died: its drawing may have been
// made and billed, so it is never drawn again on its own.
const patienceMillis = 3 * 60 * 1000

/** Whether a claimed drawing has outlived any delivery that could still finish it. */
const isStale = (picture: Pick<PictureRow, 'state' | 'claimedAt'>, at: Date) =>
  picture.state === 'generating' &&
  (picture.claimedAt === null || at.getTime() - picture.claimedAt.getTime() > patienceMillis)

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
const cutoutAt = (parts: Parts, key: string | null) =>
  key === null
    ? Effect.succeed(Option.none<Rgba>())
    : readObject(parts, key).pipe(
        Effect.map((bytes) =>
          Option.flatMap(bytes, decoded).pipe(Option.filter((picture) => opaqueShare(picture) < 0.98)),
        ),
      )

const asPng = (picture: Rgba): Picture => ({ bytes: encodePng(picture), contentType: 'image/png' })

/** A picture as a provider sees it: at most `longest` pixels, on light grey instead of transparency. */
const sent = (picture: Rgba, longest: number) => asPng(flatten(shrink(picture, longest)))

/** The keyed drawing cropped to the garment, with a little room around it. */
const framed = (keyed: Rgba) => {
  const bounds = opaqueBounds(keyed)
  if (bounds === undefined) return keyed
  const room = Math.round(margin * Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top))
  return crop(keyed, {
    left: bounds.left - room,
    top: bounds.top - room,
    right: bounds.right + room,
    bottom: bounds.bottom + room,
  })
}

/** Move a picture on from one of `from`; whether it moved. Every write goes through here, so two deliveries never
 * both act on one state. */
const move = (parts: Parts, pieceId: string, from: ReadonlyArray<PictureState>, changes: Partial<PictureRow>) =>
  Effect.gen(function* () {
    const moved = yield* storedAs(parts.store.movePicture(pieceId, from, { ...changes, updatedAt: yield* now }))
    if (moved && changes.state !== undefined) yield* Effect.annotateCurrentSpan('styld.picture.state', changes.state)
    return moved
  })

const remove = (parts: Parts, key: string | null) =>
  key === null ? Effect.void : Effect.tryPromise({ try: () => parts.bindings.bucket.delete(key), catch: unavailable })

/** A drawing that cannot finish: the photo stays the piece's picture. */
const end = (parts: Parts, pieceId: string, from: PictureState, errorCode: string) =>
  move(parts, pieceId, [from], { state: 'failed', errorCode })

/** A stored drawing that cannot be checked ends, and its file goes. */
const endChecking = (parts: Parts, picture: PictureRow, errorCode: string) =>
  Effect.gen(function* () {
    if (yield* move(parts, picture.pieceId, ['checking'], { state: 'failed', errorCode, cleanKey: null }))
      yield* remove(parts, picture.cleanKey)
  })

/** Ask the decision model how like the real cut-out the drawing is, and show it, offer it or drop it. */
const check = (parts: Parts, picture: PictureRow, drawn: Rgba, real: Rgba) =>
  Effect.gen(function* () {
    const policy = (yield* CaptureConfig).pictures
    const comparison = yield* (yield* GarmentVision).compare(sent(drawn, judgedAt), sent(real, judgedAt))
    const scores = { same: comparison.same, faithful: comparison.faithful }
    const gate = gateFor(comparison, policy)
    if (gate !== 'rejected') return yield* move(parts, picture.pieceId, ['checking'], { ...scores, state: gate })
    if (yield* move(parts, picture.pieceId, ['checking'], { ...scores, state: 'rejected', cleanKey: null }))
      yield* remove(parts, picture.cleanKey)
    return true
  })

/** Draw a claimed picture, key its background out and store it. Muse refusing ends it; Muse busy hands it back to
 * the queue; an answer lost on the way ends it as unknown, never drawn again. The stored drawing and the picture now
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
          Effect.as(end(parts, pieceId, 'generating', 'unknown'), Option.none<Picture>()),
        ),
        Effect.catchTag('ProviderFailed', (error) =>
          error.retryable
            ? Effect.andThen(
                move(parts, pieceId, ['generating'], {
                  state: 'queued',
                  version: claimed.version - 1,
                  claimedAt: null,
                }),
                Effect.fail(error),
              )
            : Effect.as(end(parts, pieceId, 'generating', 'refused'), Option.none<Picture>()),
        ),
      )
    const ended = Option.none<{ readonly clean: Rgba; readonly checking: PictureRow }>()
    if (Option.isNone(answer)) return ended
    const keyed = Option.flatMap(decoded(answer.value.bytes), (drawn) => chromaKey(shrink(drawn, keyedAt), key))
    if (Option.isNone(keyed)) {
      yield* end(parts, pieceId, 'generating', 'key')
      return ended
    }
    const clean = framed(keyed.value)
    const cleanKey = pictureKey(claimed.accountId, pieceId, claimed.version)
    const written = yield* writeObject(parts, cleanKey, encodePng(clean), 'image/png').pipe(
      Effect.retry({ times: 2, schedule: Schedule.exponential('200 millis') }),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!written) {
      yield* end(parts, pieceId, 'generating', 'unavailable')
      return ended
    }
    // A delivery that gave up on the picture meanwhile has ended it; its drawing goes.
    if (!(yield* move(parts, pieceId, ['generating'], { state: 'checking', cleanKey }))) {
      yield* remove(parts, cleanKey)
      return ended
    }
    return Option.some({ clean, checking: { ...claimed, state: 'checking' as const, cleanKey } })
  })

/** A queued picture: judge the cut-out, then keep the photo, ask for a retake, or claim and draw it. */
const start = (parts: Parts, picture: PictureRow) =>
  Effect.gen(function* () {
    const policy = (yield* CaptureConfig).pictures
    if (policy.generator === 'off') return
    const { pieceId } = picture
    const piece = yield* storedAs(parts.wardrobeStore.findPiece(picture.accountId, pieceId))
    if (Option.isNone(piece)) return
    const front = yield* cutoutAt(parts, piece.value.imageKey)
    if (Option.isNone(front)) return yield* move(parts, pieceId, ['queued'], { state: 'kept-real' })
    const judgement = yield* (yield* GarmentVision).judge(sent(front.value, judgedAt))
    const judged = { judge: judgement.verdict, judgeConfidence: judgement.confidence, face: judgement.face }
    const { plan } = planFor(judgement, policy)
    if (plan !== 'draw') return yield* move(parts, pieceId, ['queued'], { ...judged, state: plan })
    const generator = yield* ImageGenerator
    const claim = {
      ...judged,
      state: 'generating' as const,
      version: picture.version + 1,
      keyColour: keyColourFor(front.value),
      provider: generator.provider,
      model: generator.model,
      claimedAt: yield* now,
      errorCode: null,
    }
    if (!(yield* move(parts, pieceId, ['queued'], claim))) return
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

/** The queue side of clean pictures. */
export const picturing = (parts: Parts) => ({
  /** Carry a piece's clean picture as far as it goes. A drawing claimed by a delivery still within its patience is
   * left to it; a finished picture is left as it is. */
  processPicture: Effect.fn('Styld.Picture.process')(function* (pieceId: string) {
    const found = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isNone(found)) return
    const picture = found.value
    if (!(yield* storedAs(parts.wardrobeStore.accountEnabled(picture.accountId)))) return
    if (picture.state === 'queued') return yield* start(parts, picture)
    if (picture.state === 'checking') return yield* checkStored(parts, picture)
    if (isStale(picture, yield* now)) yield* end(parts, pieceId, 'generating', 'unknown')
  }),
  /** The last attempt failed: the photo stays. A drawing that may have been made counts as unknown. */
  failPicture: Effect.fn('Styld.Picture.fail')(function* (pieceId: string) {
    const found = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isNone(found)) return
    const picture = found.value
    if (picture.state === 'queued') yield* end(parts, pieceId, 'queued', 'gave-up')
    else if (picture.state === 'generating') yield* end(parts, pieceId, 'generating', 'unknown')
    else if (picture.state === 'checking') yield* endChecking(parts, picture, 'gave-up')
  }),
})
