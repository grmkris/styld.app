import { type LandingAnswerPiece, type LandingFilmName, landingFilms, landingMediaPath } from '@styld/protocol'

// Every film and picture the landing shows, read from `/cdn/landing/<name>` (`@styld/protocol` › Landing.ts names them,
// the API Worker serves them from the media bucket). None is bundled.

export const landingMedia = {
  /** A screen's film in both shapes, with their posters. */
  film: (name: LandingFilmName) => {
    const { tall, wide, posterTall, posterWide } = landingFilms[name]
    return {
      tall: landingMediaPath(tall),
      wide: landingMediaPath(wide),
      posterTall: landingMediaPath(posterTall),
      posterWide: landingMediaPath(posterWide),
    }
  },
  /** A piece in Styld's answer on the Ask Styld screen. */
  answerPiece: (piece: LandingAnswerPiece) => landingMediaPath(`shop-${piece}.webp`),
}
