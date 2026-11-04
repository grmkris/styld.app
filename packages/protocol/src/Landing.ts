// The signed-out Home's films and pictures (owner, 4 November 2026): the wardrobe's film for every visitor, then one
// screen per feature. The files are never bundled or committed; the operator uploads each to the media bucket as
// `landing/<name>` and the API Worker serves exactly these names at `/cdn/landing/<name>` (`LandingMedia.ts`).

/** A film's four files: a tall (9:16) loop for a phone held upright, a wide (16:9) one elsewhere, each with its first
 * frame as a poster. */
export interface LandingFilm {
  readonly tall: string
  readonly wide: string
  readonly posterTall: string
  readonly posterWide: string
}

const film = (tall: string, wide: string): LandingFilm => ({
  tall: `${tall}-loop-tall.mp4`,
  wide: `${wide}-loop-wide.mp4`,
  posterTall: `${tall}-poster-tall.webp`,
  posterWide: `${wide}-poster-wide.webp`,
})

/** The films, by the screen they play on. The coat's tall cut is its one board on the oak table (`coat-board`); the
 * earlier tall cut showed the boards beside it, which read as a mirror on a phone. */
export const landingFilms = {
  hero: film('wardrobe', 'wardrobe'),
  shop: film('pile', 'pile'),
  outfits: film('coat-board', 'coat'),
  tryOn: film('mirror', 'mirror'),
} as const satisfies Record<string, LandingFilm>

export type LandingFilmName = keyof typeof landingFilms

/** The pieces on the rail, left to right: each turns on its hanger from its side to its front, from a sprite of 30
 * frames in one row (`turn-<piece>.webp`, 384x448 a frame). */
export const landingRailPieces = ['coat-camel', 'sweater-cream', 'dress-sage', 'shirt-white', 'top-stripe'] as const
export type LandingRailPiece = (typeof landingRailPieces)[number]

/** The frames in a rail piece's sprite. */
export const landingTurnFrames = 30

/** The pieces in Styld's answer on the Ask Styld screen: the camel coat over the black turtleneck, the brown trousers
 * and the tan loafers. */
export const landingAnswerPieces = ['coat-camel', 'turtleneck-black', 'trousers-brown', 'loafers-tan'] as const
export type LandingAnswerPiece = (typeof landingAnswerPieces)[number]

/** Every name the landing reads, and the only names `/cdn/landing/:name` serves. */
export const landingMediaNames: ReadonlyArray<string> = [
  ...Object.values(landingFilms).flatMap(({ tall, wide, posterTall, posterWide }) => [
    tall,
    wide,
    posterTall,
    posterWide,
  ]),
  ...landingRailPieces.map((piece) => `turn-${piece}.webp`),
  ...landingAnswerPieces.map((piece) => `shop-${piece}.webp`),
]

/** Where the browser reads a landing file. */
export const landingMediaPath = (name: string) => `/cdn/landing/${name}`
