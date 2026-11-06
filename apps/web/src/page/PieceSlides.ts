import type { PictureChoice, Piece } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

// A piece's pictures on its page, one swipe from the next (owner, 4 November 2026): its angles first, the front as
// Styld shows it (the cut-out by default, or the shop-style picture once chosen) and then its back (drawn pressed from
// the person's photo of it, or that photo while there is no drawing), and the person's own pictures last: their photo,
// the plain cut-out when it is not already first, the shop-style picture when it is drawn or being made and is not the
// main one, and the photo of the back. Eva found swiping through three pictures of the front pointless. While a drawing
// is being made its slide says so. One of them is the main picture, the one the wardrobe shows; another can be made the
// main one where the piece's choice allows it (the drawing or its cut-out, `ChoosePicture`).

/** One of a piece's pictures on its page. */
export const Slide = Schema.Literals(['clean', 'backClean', 'photo', 'cutout', 'back'])
export type Slide = typeof Slide.Type

/** Where a press on the picture began, to tell a sideways swipe from a tap or a scroll. */
const Press = Schema.Struct({ x: Schema.Number, y: Schema.Number })
type Press = typeof Press.Type

// MODEL

export const Model = Schema.Struct({
  /** The picture the person swiped or tapped to; none shows the main one. */
  slide: Schema.Option(Slide),
  /** Where a press on the picture began. */
  press: Schema.Option(Press),
})
export type Model = typeof Model.Type

export const init: Model = { slide: Option.none(), press: Option.none() }

/** How far a press must travel sideways, and how much more than it travels up or down, to be a swipe (T-17). */
const swipeDistance = 48
const swipeSlant = 1.5

/** Whether the piece's shop-style picture is drawn and shown to its owner. */
const isDrawn = (piece: Piece) => piece.picture?.state === 'ready' && piece.images?.clean !== undefined

/** The piece's pictures, in their order: its front (the picture the wardrobe shows), its back (the drawn one, else the
 * photo of it), then the rest of the person's own: the photo, the cut-out when there is one and it is not already first,
 * the shop-style picture when it is drawn or being made and is not already first, and the photo of the back when its
 * drawing came first. */
export const slidesOf = (piece: Piece): ReadonlyArray<Slide> => {
  const front = mainSlide(piece)
  const drawnBack = piece.images?.backClean !== undefined
  const back: ReadonlyArray<Slide> = drawnBack ? ['backClean'] : piece.hasBack ? ['back'] : []
  const shop: ReadonlyArray<Slide> = isDrawn(piece) || piece.picture?.state === 'drawing' ? ['clean'] : []
  const own: ReadonlyArray<Slide> = [
    'photo',
    ...(piece.images?.cutout === undefined ? [] : (['cutout'] as const)),
    ...shop,
    ...(drawnBack && piece.hasBack ? (['back'] as const) : []),
  ]
  return [front, ...back, ...own.filter((slide) => slide !== front)]
}

/** The picture the wardrobe shows of it: the drawing when its owner chose it, else its cut-out, else its photo. */
export const mainSlide = (piece: Piece): Slide => {
  if (isDrawn(piece) && piece.picture?.shows === 'clean') return 'clean'
  return piece.images?.cutout === undefined ? 'photo' : 'cutout'
}

/** The picture the page shows: the one the person swiped to while the piece still has it, else the main one. */
export const currentSlide = (piece: Piece, chosen: Option.Option<Slide>): Slide =>
  Option.getOrElse(
    Option.filter(chosen, (slide) => slidesOf(piece).includes(slide)),
    () => mainSlide(piece),
  )

/** What making this picture the main one asks the piece to show, when it can be: the drawing, or the photo the piece
 * shows instead (its cut-out, or the photo itself when it was never cut out). Never for the main picture, the back, or
 * the photo a cut-out was made from. */
export const choiceOf = (piece: Piece, slide: Slide): Option.Option<PictureChoice> => {
  if (slide === mainSlide(piece) || slide === 'back') return Option.none()
  if (slide === 'clean') return isDrawn(piece) ? Option.some('clean') : Option.none()
  const shownPhoto = piece.images?.cutout === undefined ? 'photo' : 'cutout'
  return slide === shownPhoto ? Option.some('photo') : Option.none()
}

/** The picture a press let go of shows: the next on a leftward swipe, the one before on a rightward, the same
 * otherwise. */
const swiped = (piece: Piece, chosen: Option.Option<Slide>, press: Press, x: number, y: number): Slide => {
  const slides = slidesOf(piece)
  const current = currentSlide(piece, chosen)
  const across = x - press.x
  if (Math.abs(across) < swipeDistance || Math.abs(across) <= Math.abs(y - press.y) * swipeSlant) return current
  const at = slides.indexOf(current) + (across < 0 ? 1 : -1)
  return slides[Math.min(Math.max(at, 0), slides.length - 1)] ?? current
}

// UPDATE

/** The person tapped a picture's dot. */
export const chose = (model: Model, slide: Slide): Model => modifyFields(model, { slide: () => Option.some(slide) })

/** A press on the picture began. */
export const pressed = (model: Model, x: number, y: number): Model =>
  modifyFields(model, { press: () => Option.some({ x, y }) })

/** A press let go: a sideways swipe shows the next picture or the one before, for the piece as the page shows it
 * (none while it loads). */
export const released = (model: Model, piece: Option.Option<Piece>, x: number, y: number): Model =>
  modifyFields(model, {
    press: () => Option.none(),
    slide: (slide) =>
      Option.isSome(piece) && Option.isSome(model.press)
        ? Option.some(swiped(piece.value, slide, model.press.value, x, y))
        : slide,
  })

/** The piece's back changed: a new back shows at once, and without one the main picture does. */
export const backChanged = (model: Model, hasBack: boolean): Model =>
  modifyFields(model, { slide: () => (hasBack ? Option.some<Slide>('back') : Option.none()) })
