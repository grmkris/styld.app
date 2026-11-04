import { Colour, type Learned, PieceType } from '@styld/protocol'
import { Schema } from 'effect'

// What Styld works out from what a person saves and wears (owner, 4 November 2026). Pure, and only ever positive: a
// colour nobody wears is not something they dislike, so avoiding comes only from what the person said (their notes).

/** A piece the person wore, kept in a look or loved in a photo: its kind and colours. One entry per time. */
export interface Wearing {
  readonly type: string
  readonly colours: ReadonlyArray<string>
}

/** What `learnedFrom` reads: the pieces worn, kept and loved, and the aesthetics of the boards the person saved. */
export interface Signals {
  readonly wearings: ReadonlyArray<Wearing>
  readonly savedAesthetics: ReadonlyArray<string>
}

/** How many of each are told: the strongest few, so a reply's instructions stay short. */
const mostLearned = { aesthetics: 3, colours: 4, wornTypes: 4 } as const

/** The values seen at least `least` times, most often first, then by name so the same signals always read alike. */
const strongest = (values: ReadonlyArray<string>, most: number, least: number): ReadonlyArray<string> => {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count >= least)
    .toSorted(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, most)
    .map(([value]) => value)
}

const isColour = Schema.is(Colour)
const isPieceType = Schema.is(PieceType)

/** A colour or kind of piece counts once it shows twice; one saved board is enough to tell an aesthetic. */
const leastWorn = 2

/** The strongest aesthetics, colours and kinds of piece in the person's signals. Values outside the contract's lists
 * (a row written before a type was renamed) are left out. */
export const learnedFrom = (signals: Signals): Learned => ({
  aesthetics: strongest(signals.savedAesthetics, mostLearned.aesthetics, 1),
  colours: strongest(
    signals.wearings.flatMap((wearing) => wearing.colours).filter(isColour),
    mostLearned.colours,
    leastWorn,
  ).filter(isColour),
  wornTypes: strongest(
    signals.wearings.map((wearing) => wearing.type).filter(isPieceType),
    mostLearned.wornTypes,
    leastWorn,
  ).filter(isPieceType),
})
