import type { PieceType } from '@styld/protocol'
import { capturePolicy } from '../capture/Policy.ts'

// Whether a house garment is whole enough for its boards (owner, 4 November 2026): Clef's whole-garment score must
// reach the capture's own drop bar, except for small things (a belt, jewellery, a hair clip, sunglasses, gloves,
// socks), which Clef reads as scraps however well they are drawn.

const smallThings: ReadonlySet<PieceType> = new Set([
  'belts',
  'jewellery',
  'hairAccessories',
  'eyewear',
  'gloves',
  'socks',
])

/** Whether Clef's reading of a garment lets its boards be seeded: no reading, a small thing, or whole enough. */
export const wholeEnough = (type: PieceType, whole: number | null) =>
  whole === null || smallThings.has(type) || whole >= capturePolicy.garments.whole.drop
