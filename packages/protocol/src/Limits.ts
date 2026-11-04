// How many of a thing the contract takes. The server refuses more; the website stops the person at the same count.

/** A piece's colours. */
export const maximumColours = 6
/** What a piece is worn for. */
export const maximumOccasions = 5
/** One look: a full outfit with its accessories. */
export const maximumLookPieces = 12
/** One day's recorded outfit. */
export const maximumWornPieces = 12
/** A board's moods. */
export const maximumMoods = 3
/** The things one board's table holds: eight complete outfits of up to eight pieces around their anchor fit (Eva's
 * layouts, 4 November 2026; it was 60). */
export const maximumBoardItems = 80
/** The things pinned on one board, and the most one call pins or unpins. */
export const maximumBoardPins = 500
export const pinsAtOnce = 50
/** The proposals one outfit request returns, the pieces it locks, and the combinations it says were shown. */
export const mostProposals = 6
export const mostLocked = 5
export const mostSeen = 60
/** A photo's bytes. */
export const maximumImageBytes = 15 * 1024 * 1024
/** A video's bytes: a Worker request carries at most 100 MB, and a minute of 1080p phone video fits under this. */
export const maximumVideoBytes = 95 * 1024 * 1024
