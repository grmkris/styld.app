// How long a claimed drawing may run: the painter's 90 s timeout (Muse's), plus keying and storing it, with room to
// spare. A claim older than this belongs to a delivery that died; its drawing may have been made and billed, so it is
// never drawn again on its own. One figure for every drawing claim (a sticker, a piece's clean picture).

/** The patience of a claimed drawing, in milliseconds. */
export const drawingPatienceMillis = 3 * 60 * 1000
