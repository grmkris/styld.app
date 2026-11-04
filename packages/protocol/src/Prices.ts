// What each paid action costs, in credits from the account's daily allowance. The server holds this many before the
// work runs and gives them back when nothing comes of it; the website and the assistants quote the same numbers.

/** The credits every account has each UTC day; unused ones do not carry over. Changing it is a commit. */
export const dailyCredits = 100

/** Styld Premium Week (owner, 4 November 2026): this many credits a day instead, for `days` days from the purchase,
 * for one payment of `price` (US dollars, shown as Dodo charges it). Buying again extends from the current end. */
export const premiumWeek = { dailyCredits: 500, days: 7, price: '$4.99' } as const

export const prices = {
  /** A photo's garments found and cut out (owner, 30 October). A piece's back is free (owner, 4 November): the camera
   * asks for it after each front, and a back is what Styld's carousel turns the piece to. */
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
