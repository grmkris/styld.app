import type { Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { cdn } from '../Cdn.ts'
import { formError } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { Choosing, Message, type Model, ShowTurn } from './Piece.ts'
import { choiceOf, currentSlide, mainSlide, type Slide, slidesOf } from './PieceSlides.ts'
import { pieceLabel } from './WardrobeWords.ts'
import * as pieceStyles from './PieceView.styles.ts'
import * as styles from './PieceCarouselView.styles.ts'

// A piece's pictures on its page, one swipe from the next (owner, 4 November 2026; T-17's swipe): the shown one, dots
// that name and choose each, what it is, and making it the main picture where it can be (`PieceSlides.ts`).

const names = {
  clean: 'wardrobe.picture.clean',
  backClean: 'wardrobe.back',
  photo: 'wardrobe.picture.photo',
  cutout: 'wardrobe.picture.cutout',
  back: 'wardrobe.back',
} as const

/** What a picture is called: the photo of the back says so beside the back's drawing. */
const nameOf = (piece: Piece, slide: Slide) =>
  slide === 'back' && piece.images?.backClean !== undefined ? 'wardrobe.picture.backPhoto' : names[slide]

/** The picture's address on the piece: the photo it came from, or the picture it shows when it never had another. */
const addressOf = (piece: Piece, slide: Slide) => {
  const images = piece.images
  if (slide === 'clean') return images?.clean ?? ''
  if (slide === 'cutout') return images?.cutout ?? ''
  if (slide === 'backClean') return images?.backClean ?? ''
  if (slide === 'back') return cdn.pieceBack(piece)
  return images?.photo ?? cdn.piece(piece, 'full')
}

/** The quarter turn a picture is shown with on top of the one it arrives with, as a data attribute (zyzz composes only
 * statically known styles). The server turns the person's photo and cut-out by the saved rotation and never the
 * drawing or the back, so outside Edit nothing turns here; in Edit the photo and cut-out preview only the turn not yet
 * saved. */
const previewTurn = (piece: Piece, model: Model, slide: Slide) =>
  slide === 'photo' || slide === 'cutout'
    ? Option.match(model.draft, {
        onNone: () => 0,
        onSome: (draft) => (draft.rotation - piece.rotation + 360) % 360,
      })
    : 0

/** The shop-style picture: its turn, played on tap, once one is ready; else the drawing. */
const drawing = (
  piece: Piece,
  model: Model,
  still: (hidden: boolean) => Html,
  locale: Locale,
  h: HtmlBuilder<Message>,
) => {
  const turn = piece.turn
  const sheet = turn?.media?.sheet
  if (turn?.state !== 'ready' || turn.layout === undefined || sheet === undefined) return still(false)
  // The still stays under the player until its sheet has loaded and drawn its first frame.
  return h.div(styled(h, pieceStyles.turnStack()), [
    model.turnShown ? h.empty : still(true),
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(format(locale, 'wardrobe.turn.play', {})),
        h.AriaPressed('false'),
        ...styled(h, pieceStyles.turnButton()),
      ],
      [
        h.canvas([
          h.Role('img'),
          h.AriaLabel(pieceLabel(piece, locale)),
          h.OnMount(ShowTurn({ sheet, layout: turn.layout })),
          ...styled(h, styles.cutout()),
        ]),
      ],
    ),
  ])
}

/** One of the piece's pictures, named for what it is; the drawing's slide says so while it is being made. */
const slideView = (piece: Piece, model: Model, slide: Slide, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (slide === 'clean' && piece.picture?.state === 'drawing')
    return h.p(
      [h.Role('status'), ...styled(h, cx(styles.making(), styles.slide()))],
      [loader(h), format(locale, 'wardrobe.picture.making', {})],
    )
  const label = pieceLabel(piece, locale)
  const alt =
    slide === 'back' || slide === 'backClean'
      ? format(locale, 'wardrobe.backAlt', { name: label })
      : slide === mainSlide(piece)
        ? label
        : format(locale, 'wardrobe.picture.slideAlt', {
            name: label,
            picture: format(locale, nameOf(piece, slide), {}),
          })
  const still = (hidden: boolean) =>
    h.img([
      h.Src(addressOf(piece, slide)),
      h.Alt(alt),
      h.Draggable(false),
      ...(hidden ? [h.AriaHidden(true)] : []),
      h.DataAttribute('rotation', String(previewTurn(piece, model, slide))),
      // The person's photo shows its own backdrop; a cut-out lies on the paper.
      ...(slide === 'photo'
        ? styled(h, cx(styles.photo(), pieceStyles.rotated()))
        : styled(h, cx(styles.cutout(), pieceStyles.rotated()))),
    ])
  return h.keyed('div')(`slide-${slide}`, styled(h, styles.slide()), [
    slide === 'clean' ? drawing(piece, model, still, locale, h) : still(false),
  ])
}

/** A dot for each picture, naming it, the shown one current. */
const dotsView = (
  piece: Piece,
  slides: ReadonlyArray<Slide>,
  current: Slide,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'wardrobe.picture.pictures', {})), ...styled(h, styles.dots())],
    slides.map((slide) =>
      h.button([
        h.Type('button'),
        h.AriaLabel(format(locale, nameOf(piece, slide), {})),
        h.AriaCurrent(String(slide === current)),
        h.OnClick(Message.ClickedSlide({ slide })),
        ...styled(h, styles.dot()),
      ]),
    ),
  )

/** What the shown picture is: the main picture, or a drawing's note; and making it the main one where it can be. */
const captionView = (piece: Piece, model: Model, current: Slide, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const making = current === 'clean' && piece.picture?.state === 'drawing'
  const isMain = current === mainSlide(piece)
  const note = isMain
    ? Option.some(format(locale, 'wardrobe.picture.main', {}))
    : (current === 'clean' && !making) || current === 'backClean'
      ? Option.some(format(locale, 'wardrobe.picture.cleaned', {}))
      : Option.none()
  return h.div(styled(h, styles.caption()), [
    h.p(styled(h, styles.name()), [
      h.span(styled(h, styles.title()), [format(locale, nameOf(piece, current), {})]),
      Option.match(note, { onNone: () => h.empty, onSome: (text) => h.span(styled(h, styles.note()), [text]) }),
    ]),
    Option.match(choiceOf(piece, current), {
      onNone: () => h.empty,
      onSome: (use) =>
        actionButton(
          {
            label: format(locale, 'wardrobe.picture.useAsMain', {}),
            style: secondaryAction(),
            onClick: Message.ClickedShowPicture({ use }),
            isDisabled: Choosing.guards.Sending(model.choosing),
          },
          h,
        ),
    }),
  ])
}

/** The piece's pictures: the shown one, swiped sideways to the next, its dots, and what it is. */
export const carousel = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const slides = slidesOf(piece)
  const current = currentSlide(piece, model.slides.slide)
  return h.section(
    [h.AriaLabel(format(locale, 'wardrobe.picture.pictures', {})), ...styled(h, styles.carousel())],
    [
      h.div(
        [
          h.OnPointerDown((_type, _button, screenX, screenY) =>
            Option.some(Message.PressedPicture({ x: screenX, y: screenY })),
          ),
          h.OnPointerUp((screenX, screenY) => Option.some(Message.ReleasedPicture({ x: screenX, y: screenY }))),
          ...styled(h, styles.frame()),
        ],
        [slideView(piece, model, current, locale, h)],
      ),
      slides.length > 1 ? dotsView(piece, slides, current, locale, h) : h.empty,
      captionView(piece, model, current, locale, h),
      Choosing.guards.Failed(model.choosing)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.picture.chooseFailed', {})])
        : h.empty,
    ],
  )
}
