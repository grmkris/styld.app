import { Effect, Option } from 'effect'
import { newId } from '../kernel/Ids.ts'
import { type Garment } from './Garments.ts'
import { verdictOf } from './GarmentRules.ts'
import { captureKey, readObject, unavailable, writeObject } from './Shared.ts'
import type { Route } from './Providers.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { Garments } from './Garments.ts'

/** What a capture's pipeline found, and how it was routed. */
export interface Found {
  readonly found: ReadonlyArray<DetectionRow>
  readonly route: Route | null
  readonly provider: string
}

/** A detection waiting in the tray for one garment found in `sourceKey` (the photo, or a video's still), its cut-out
 * stored under the capture. A whole garment of a known kind is compared with the import's other sightings and the
 * wardrobe; part of one is not. */
export const detectionsOf = (
  capture: CaptureRow,
  found: ReadonlyArray<{ readonly garment: Garment; readonly sourceKey: string }>,
) =>
  Effect.forEach(
    found,
    ({ garment, sourceKey }) =>
      Effect.gen(function* () {
        const id = yield* newId('dt')
        const key = captureKey(capture.accountId, capture.id, `${id}.png`)
        yield* writeObject(key, garment.png, 'image/png')
        const { suggestion } = garment
        const whole = verdictOf(suggestion.whole) === 'preselect' && suggestion.type !== undefined
        return {
          id,
          captureId: capture.id,
          accountId: capture.accountId,
          status: 'review',
          cutoutKey: key,
          sourceKey,
          backCutoutKey: null,
          confidence: garment.confidence,
          preselected: garment.preselect,
          suggestedType: suggestion.type ?? null,
          suggestedColours: suggestion.colours,
          suggestedSeason: suggestion.season ?? null,
          suggestedOccasions: suggestion.occasions,
          suggestedPattern: suggestion.pattern ?? null,
          whole: suggestion.whole,
          groupOf: null,
          duplicateOf: null,
          matching: whole ? 'waiting' : null,
          matchClaimedAt: null,
          createdAt: capture.createdAt,
        } satisfies DetectionRow
      }),
    { concurrency: 4 },
  )

/** Cut a photo into the garments it shows, as detections. */
export const processPhoto = Effect.fn('Styld.Capture.processPhoto')(function* (capture: CaptureRow) {
  const original = yield* readObject(capture.originalKey)
  if (Option.isNone(original)) return yield* unavailable()
  const finding = yield* (yield* Garments).find(original.value, {
    for: 'tray',
    camera: capture.source === 'camera',
  })
  const found = yield* detectionsOf(
    capture,
    finding.garments.map((garment) => ({ garment, sourceKey: capture.originalKey })),
  )
  return { found, route: Option.getOrNull(finding.route), provider: finding.provider } satisfies Found
})
