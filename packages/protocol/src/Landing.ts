// The signed-out Home's films and pictures (owner, 4 November 2026): the wardrobe's film for every visitor, and the page
// below it. The files are never bundled or committed; the operator uploads each to the media bucket as
// `landing/<name>` and the API Worker serves exactly these names at `/cdn/landing/<name>` (`LandingMedia.ts`).

/** The cut-outs the shop grid shows, by the category the grid sorts them under. */
export const landingShopPieces = [
  // The first six are what All shows, one of each kind; a chip finds the rest.
  { piece: 'coat-camel', category: 'outerwear' },
  { piece: 'sweater-cream', category: 'top' },
  { piece: 'jeans-light', category: 'bottom' },
  { piece: 'dress-sage', category: 'dress' },
  { piece: 'boots-black', category: 'shoes' },
  { piece: 'bag-cognac', category: 'accessory' },
  { piece: 'shirt-white', category: 'top' },
  { piece: 'top-stripe', category: 'top' },
  { piece: 'turtleneck-black', category: 'top' },
  { piece: 'trousers-brown', category: 'bottom' },
  { piece: 'skirt-ivory', category: 'bottom' },
  { piece: 'sneakers-white', category: 'shoes' },
  { piece: 'loafers-tan', category: 'shoes' },
] as const

export type LandingShopPiece = (typeof landingShopPieces)[number]['piece']

/** The hero's four files, the wardrobe's film (owner, 4 November 2026: one hero for everyone): a tall (9:16) and a wide
 * (16:9) loop, each with its first frame as a poster. */
const heroFiles = [
  'wardrobe-loop-tall.mp4',
  'wardrobe-loop-wide.mp4',
  'wardrobe-poster-tall.webp',
  'wardrobe-poster-wide.webp',
] as const
export type HeroFile = (typeof heroFiles)[number]

/** The feature screens' clips, each with a poster: adding a piece (tall), and the coat's six outfits, whose wide film
 * the page crops to its one board (the tall cut showed the boards beside it, which read as a mirror). */
const clipFiles = ['scan-tall.mp4', 'scan-tall.webp', 'coat-loop-wide.mp4', 'coat-poster-wide.webp'] as const
export type ClipFile = (typeof clipFiles)[number]

/** Every name the landing reads, and the only names `/cdn/landing/:name` serves. */
export const landingMediaNames: ReadonlyArray<string> = [
  ...heroFiles,
  ...clipFiles,
  ...landingShopPieces.map(({ piece }) => `shop-${piece}.webp`),
]

/** Where the browser reads a landing file. */
export const landingMediaPath = (name: string) => `/cdn/landing/${name}`
