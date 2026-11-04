import type { GarmentRow } from './Store.ts'

/** Styld's own guess about a garment it found: suggested or unmatched, with a cut-out from the photo. */
const guess = ({ state, cutoutKey }: GarmentRow) =>
  (state === 'suggested' || state === 'unmatched') && cutoutKey !== null

/** What a re-find leaves of a photo's garments: Styld's guesses (suggested or unmatched, found in the photo) give way;
 * the rest stays, and what was found now follows it, less any garment suggesting a piece already confirmed in it. */
export const mergedWith = (garments: ReadonlyArray<GarmentRow>, found: ReadonlyArray<GarmentRow>) => {
  const kept = garments.filter((garment) => !guess(garment))
  const confirmed = new Set(
    kept.flatMap(({ state, pieceId }) => (state === 'confirmed' && pieceId !== null ? [pieceId] : [])),
  )
  const after = Math.max(-1, ...kept.map(({ position }) => position)) + 1
  const added = found
    .filter(({ pieceId }) => pieceId === null || !confirmed.has(pieceId))
    .map((garment, index) => ({ ...garment, position: after + index }))
  const replaced = garments.filter(guess).filter(({ id }) => !found.some((garment) => garment.id === id))
  return { added, replaced }
}
