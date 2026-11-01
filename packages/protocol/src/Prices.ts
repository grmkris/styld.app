// What each paid action costs, in credits from the account's daily allowance. The server holds this many before the
// work runs and gives them back when nothing comes of it; the website and the assistants quote the same numbers.

export const prices = {
  /** A photo's garments found and cut out, and a piece's back (owner, 30 October). */
  photo: 1,
  /** Each started half-minute of a video, about 10 credits a minute. */
  videoHalfMinute: 5,
  /** A clean picture drawn again; the first drawing is free (owner, 30 October). */
  redraw: 1,
  /** A clean picture turning on its hanger (owner, 30 October). */
  turn: 5,
  /** One message to Styld, the stylist in the app (owner, 31 October). */
  stylistMessage: 1,
  /** A sticker for a board, and a mood board of the person's own pieces. */
  sticker: 1,
  moodBoard: 1,
  /** A photo added to My Gallery, for finding the clothes in it. */
  galleryPhoto: 1,
} as const
