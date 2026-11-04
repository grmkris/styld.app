import { Schema } from 'effect'

// The signed-out Home's films and pictures (owner, 4 November 2026): three heroes, one per visitor, and the shared page
// below them. The files are never bundled or committed; the operator uploads each to the media bucket as
// `landing/<name>` and the API Worker serves exactly these names at `/cdn/landing/<name>` (`LandingMedia.ts`).

/** The three heroes a visitor may get: the mirror, the one coat and the wardrobe to page. */
export const LandingHero = Schema.Literals(['mirror', 'coat', 'wardrobe'])
export type LandingHero = typeof LandingHero.Type

export const landingHeroes: ReadonlyArray<LandingHero> = LandingHero.literals

/** The first-party cookie that keeps a visitor's hero, so a second visit shows the same film and a sign-up is counted
 * against it. Its value is a hero's name and nothing else. */
export const landingHeroCookie = 'styld_hero'

/** How long the hero is kept: half a year. */
export const landingHeroCookieSeconds = 60 * 60 * 24 * 182

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

/** A hero's four files: a tall (9:16) and a wide (16:9) loop, each with its first frame as a poster. */
const heroFiles = ['loop-tall.mp4', 'loop-wide.mp4', 'poster-tall.webp', 'poster-wide.webp'] as const
export type HeroFile = (typeof heroFiles)[number]

/** The feature screens' tall clips (scan: adding a piece; outfits: the coat's six outfits), each with a poster. */
const clipFiles = ['scan-tall.mp4', 'scan-tall.webp', 'outfits-tall.mp4', 'outfits-tall.webp'] as const

/** Every name the landing reads, and the only names `/cdn/landing/:name` serves. */
export const landingMediaNames: ReadonlyArray<string> = [
  ...landingHeroes.flatMap((hero) => heroFiles.map((file) => `${hero}-${file}`)),
  ...clipFiles,
  ...landingShopPieces.map(({ piece }) => `shop-${piece}.webp`),
]

/** Where the browser reads a landing file. */
export const landingMediaPath = (name: string) => `/cdn/landing/${name}`
