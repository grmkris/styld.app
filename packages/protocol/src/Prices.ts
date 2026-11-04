// What each paid action costs, in credits. The server holds this many before the work runs and gives them back when
// nothing comes of it; the website and the assistants quote the same numbers.

/** The credits a new account has once, enough for three photos' cut-outs; they never reset (owner, 4 November 2026).
 * Without a plan the day brings no credits. Changing it is a commit. */
export const freeCredits = 3

/** The credits each UTC day brings while a plan is active; unused ones do not carry over. */
export const memberDailyCredits = 500

/** The plans, each giving `memberDailyCredits` a day while it lasts (owner, 4 November 2026), priced in US dollars as
 * Dodo charges them. A week extends from the current end when bought again; monthly and yearly renew until cancelled;
 * lifetime never ends. */
export const planNames = ['week', 'monthly', 'yearly', 'lifetime'] as const
export type PlanName = (typeof planNames)[number]

export const plans = {
  week: { price: '$4.99', days: 7, renews: false },
  monthly: { price: '$20', renews: true },
  yearly: { price: '$200', renews: true },
  lifetime: { price: '$349', renews: false },
} as const satisfies Record<PlanName, { readonly price: string; readonly days?: number; readonly renews: boolean }>

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
  /** One of the person's own photos redrawn with them wearing pieces of their wardrobe (owner, 4 November). */
  tryOn: 2,
} as const
