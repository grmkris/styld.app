import { PieceType, slotOf, typesInSlot } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type { MatchOutcome, MatchScope } from './MatchStore.ts'
import { enqueueMatch, readPixels, storedAs } from './Shared.ts'
import { judgedAt } from './Garments.ts'
import { modelPicture } from '@styld/imaging'
import { capturePolicy } from './Policy.ts'
import { type Picture } from './Providers.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { GarmentVision } from './Providers.ts'
import type { CaptureServices } from './Shared.ts'

/** How long the import's next sighting is left to the delivery that claimed it, before another takes it over. */
const patienceSeconds = 180

const scopeOf = (capture: CaptureRow): MatchScope => ({
  accountId: capture.accountId,
  captureId: capture.id,
  importId: capture.importId,
})

/** A stored cut-out as the decision model compares it; none when it is gone or is not a cut-out. */
const comparable = (key: string | null) =>
  key === null
    ? Effect.succeed(Option.none<Picture>())
    : Effect.map(
        readPixels(key),
        Option.map((picture) => modelPicture(picture, judgedAt)),
      )

/** The one of `candidates` most likely the garment in `picture`, if the decision model is at least `bar` sure of it. */
export const sameAs = <A>(
  picture: Picture,
  candidates: ReadonlyArray<A>,
  keyOf: (candidate: A) => string | null,
  bar: number,
) =>
  Effect.gen(function* () {
    const vision = yield* GarmentVision
    const scored = yield* Effect.forEach(
      candidates,
      (candidate) =>
        Effect.gen(function* () {
          const other = yield* comparable(keyOf(candidate))
          return { candidate, same: Option.isNone(other) ? 0 : yield* vision.sameGarment(picture, other.value) }
        }),
      { concurrency: 4 },
    )
    const best = scored.reduce<(typeof scored)[number] | undefined>(
      (top, next) => (top === undefined || next.same > top.same ? next : top),
      undefined,
    )
    return best !== undefined && best.same >= bar ? Option.some(best.candidate) : Option.none<A>()
  })

/** The garments of `types` a capture's import already shows on their cards. A photo's own pieces are different
 * garments; a video's may be one garment SAM followed as two. */
const shownIn = (capture: CaptureRow, types: ReadonlyArray<PieceType>, limit: number) => {
  const photo = capture.kind === 'photo'
  if (photo && capture.importId === null) return Effect.succeed([])
  return storedAs(
    Effect.flatMap(CaptureStore, (store) =>
      store.shownSightings(scopeOf(capture), types, photo ? capture.id : undefined, limit),
    ),
  )
}

const isPieceType = Schema.is(PieceType)

/** The types a garment is compared within: every type that sits where it does in an outfit, so one misjudged type
 * never hides a duplicate (owner, 2026-10-31). */
export const comparedTypes = (suggested: string | null) =>
  Option.map(Option.liftPredicate(suggested, isPieceType), (type) => typesInSlot(slotOf(type)))

/** Compare one sighting: with the garments its import already shows, joining the one it is (shown in that one's
 * place when it shows more of the garment), or else with the wardrobe's pieces of its kind. */
const matchOne = (capture: CaptureRow, detection: DetectionRow) =>
  Effect.gen(function* () {
    const policy = capturePolicy.matching
    const alone: MatchOutcome = { joins: Option.none(), duplicateOf: null }
    const types = comparedTypes(detection.suggestedType)
    const own = yield* comparable(detection.cutoutKey)
    if (Option.isNone(types) || Option.isNone(own)) return alone
    const shown = yield* shownIn(capture, types.value, policy.sightings)
    const joined = yield* sameAs(own.value, shown, (row) => row.cutoutKey, policy.same)
    if (Option.isSome(joined)) {
      const head = joined.value
      const replaces = (detection.whole ?? 0) > (head.whole ?? 0)
      return { joins: Option.some({ head: head.id, replaces }), duplicateOf: replaces ? head.duplicateOf : null }
    }
    const candidates = yield* storedAs(
      (yield* CaptureStore).wardrobeCandidates(
        capture.accountId,
        types.value,
        detection.suggestedColours[0],
        policy.pieces,
      ),
    )
    const piece = yield* sameAs(own.value, candidates, (candidate) => candidate.imageKey, policy.same)
    return { ...alone, duplicateOf: Option.match(piece, { onNone: () => null, onSome: ({ id }) => id }) }
  })

/** The capture a sighting of the import was found in. */
const captureOf = (capture: CaptureRow, detection: DetectionRow) =>
  detection.captureId === capture.id
    ? Effect.succeed(Option.some(capture))
    : storedAs(Effect.flatMap(CaptureStore, (store) => store.captureForProcessing(detection.captureId)))

/** Compare the import's next waiting sighting, if no other delivery has it; whether there may be another. */
const matchNext = (capture: CaptureRow) =>
  Effect.gen(function* () {
    const [next] = yield* storedAs((yield* CaptureStore).toMatch(scopeOf(capture)))
    if (next === undefined) return false
    const at = yield* nowDate
    const claimedAt = next.matchClaimedAt?.getTime() ?? 0
    if (next.matching === 'claimed' && at.getTime() - claimedAt < patienceSeconds * 1000) {
      // Another delivery compares it and the ones after it; this one looks again in case that one gives up.
      yield* enqueueMatch(capture.id, patienceSeconds)
      return false
    }
    if (!(yield* storedAs((yield* CaptureStore).claimMatch(next, at)))) return true
    const own = yield* captureOf(capture, next)
    const outcome = Option.isNone(own)
      ? { joins: Option.none(), duplicateOf: null }
      : yield* matchOne(own.value, next).pipe(
          Effect.tapError(() => storedAs(Effect.flatMap(CaptureStore, (store) => store.releaseMatch(next.id, at)))),
        )
    yield* storedAs((yield* CaptureStore).finishMatch(next, at, outcome))
    return true
  })

/** The queue side of comparing sightings. */
export const matching = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Compare the waiting sightings of a capture's import, oldest first, one at a time, so a sighting is compared
   * with every one before it, whichever part finished first. */
  processMatch: Effect.fn('Styld.Capture.match')(function* (captureId: string) {
    const found = yield* storedAs((yield* CaptureStore).captureForProcessing(captureId))
    if (Option.isNone(found)) return
    if (!(yield* storedAs((yield* WardrobeStore).accountEnabled(found.value.accountId)))) return
    let more = true
    while (more) more = yield* matchNext(found.value)
  }, Effect.provide(context)),
  /** The last attempt failed: the import's waiting sightings stay on their own cards. */
  failMatch: Effect.fn('Styld.Capture.failMatch')(function* (captureId: string) {
    const found = yield* storedAs((yield* CaptureStore).captureForProcessing(captureId))
    if (Option.isSome(found)) yield* storedAs((yield* CaptureStore).abandonMatches(scopeOf(found.value)))
  }, Effect.provide(context)),
}))
