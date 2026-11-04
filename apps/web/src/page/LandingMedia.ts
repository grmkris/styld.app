import { type HeroFile, type LandingHero, landingMediaPath, type LandingShopPiece } from '@styld/protocol'

// Every film and picture the landing shows, read from `/cdn/landing/<name>` (`@styld/protocol` › Landing.ts names them,
// the API Worker serves them from the media bucket). None is bundled.

export const landingMedia = {
  /** One of a hero's four files. */
  hero: (hero: LandingHero, file: HeroFile) => landingMediaPath(`${hero}-${file}`),
  /** A feature screen's tall clip, or its poster. */
  clip: (clip: 'scan' | 'outfits', file: 'mp4' | 'webp') => landingMediaPath(`${clip}-tall.${file}`),
  /** A shop grid's cut-out. */
  shopPiece: (piece: LandingShopPiece) => landingMediaPath(`shop-${piece}.webp`),
}
