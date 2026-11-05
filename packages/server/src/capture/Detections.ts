import { Pattern, PieceType, Season, Unavailable } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { newId } from '../kernel/Ids.ts'
import { type Garment } from './Garments.ts'
import { verdictOf } from './GarmentRules.ts'
import { captureKey, readObject, writeObject } from './Shared.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { foundDetectionState } from './DetectionLifecycle.ts'
import { Garments } from './Garments.ts'

/** A detection the pipeline found, as its row is written. */
const FoundDetection = Schema.Struct({
  id: Schema.String,
  captureId: Schema.String,
  accountId: Schema.String,
  status: Schema.Literals(['review', 'kept', 'discarded']),
  cutoutKey: Schema.NullOr(Schema.String),
  sourceKey: Schema.String,
  backCutoutKey: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  preselected: Schema.Boolean,
  suggestedType: Schema.NullOr(PieceType),
  // A delivery recorded before the column existed carries none.
  suggestedAlternative: Schema.NullOr(PieceType).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  suggestedColours: Schema.Array(Schema.String),
  suggestedSeasons: Schema.Array(Season),
  suggestedRainproof: Schema.Boolean,
  suggestedCategory: Schema.NullOr(Schema.String),
  suggestedOccasions: Schema.Array(Schema.String),
  suggestedPattern: Schema.NullOr(Pattern),
  whole: Schema.NullOr(Schema.Number),
  groupOf: Schema.NullOr(Schema.String),
  duplicateOf: Schema.NullOr(Schema.String),
  matching: Schema.NullOr(Schema.Literals(['waiting', 'claimed', 'done'])),
  matchClaimedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
})

/** What a capture's pipeline found, and how it was routed: what a delivery keeps once SAM answered, so a retry
 * records it without asking again. */
export const Found = Schema.Struct({
  found: Schema.Array(FoundDetection),
  route: Schema.NullOr(
    Schema.Struct({
      garments: Schema.Literals(['none', 'one', 'several']),
      confidence: Schema.Number,
      person: Schema.Number,
      scene: Schema.optionalKey(Schema.Literals(['held', 'flat', 'hanging', 'worn', 'other'])),
    }),
  ),
  provider: Schema.String,
})
export type Found = typeof Found.Type

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
          status: foundDetectionState,
          cutoutKey: key,
          sourceKey,
          backCutoutKey: null,
          confidence: garment.confidence,
          preselected: garment.preselect,
          suggestedType: suggestion.type ?? null,
          suggestedAlternative: suggestion.alternative ?? null,
          suggestedColours: suggestion.colours,
          suggestedSeasons: suggestion.seasons,
          suggestedRainproof: suggestion.rainproof,
          suggestedCategory: null,
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
  if (Option.isNone(original)) return yield* Unavailable.make({})
  const finding = yield* (yield* Garments).find(original.value, {
    for: 'tray',
    camera: capture.source === 'camera',
  })
  const found = yield* detectionsOf(
    capture,
    finding.garments.map((garment) => ({ garment, sourceKey: capture.originalKey })),
  ).pipe(Effect.mapError(() => outcomeUnknown('meta-sam')))
  return { found, route: Option.getOrNull(finding.route), provider: finding.provider } satisfies Found
})
import { outcomeUnknown } from '../providers/Errors.ts'
