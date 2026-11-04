import { type ClipFile, type HeroFile, landingMediaPath, type LandingShopPiece } from '@styld/protocol'

// Every film and picture the landing shows, read from `/cdn/landing/<name>` (`@styld/protocol` › Landing.ts names them,
// the API Worker serves them from the media bucket). None is bundled.

export const landingMedia = {
  /** One of the hero's four files. */
  hero: (file: HeroFile) => landingMediaPath(file),
  /** A feature screen's clip, or its poster. */
  clip: (file: ClipFile) => landingMediaPath(file),
  /** A shop grid's cut-out. */
  shopPiece: (piece: LandingShopPiece) => landingMediaPath(`shop-${piece}.webp`),
}
