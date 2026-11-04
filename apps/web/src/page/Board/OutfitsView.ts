import { cdn } from '../../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import { type BoardOutfit, flatLay, type Paper, PieceItem } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import { lookRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { CardWork, Message, type Model, workOf } from './Outfits.ts'
import { type ImageSource, stillTable } from './Table.ts'
import * as styles from './OutfitsView.styles.ts'

/** What the cards are drawn with: the language, the board's name for a kept look's, and its paper. */
export interface Inputs {
  readonly locale: Locale
  readonly boardName: string
  readonly paper: Paper
}

/** How many outfits a board starts with; fewer means the wardrobe could not make more. */
const outfitsPerBoard = 6

/** An outfit's pieces drawn from their own pictures. */
const sourceOf =
  (outfit: BoardOutfit): ImageSource =>
  (item) =>
    Schema.is(PieceItem)(item)
      ? Option.getOrUndefined(
          Option.map(
            Array.findFirst(outfit.pieces, (piece) => piece.id === item.pieceId),
            (piece) => cdn.piece(piece),
          ),
        )
      : undefined

const problemKey = (work: CardWork) =>
  CardWork.guards.Failed(work)
    ? work.problem === 'noMore'
      ? ('outfits.noMore' as const)
      : work.problem === 'kept'
        ? ('outfits.keptElsewhere' as const)
        : ('outfits.failed' as const)
    : undefined

const actionsView = (
  model: Model,
  outfit: BoardOutfit,
  position: number,
  canReplace: boolean,
  { locale, boardName }: Inputs,
  h: HtmlBuilder<Message>,
): Html => {
  if (outfit.lookId !== null)
    return h.p(styled(h, styles.note()), [
      format(locale, 'outfits.kept', {}),
      ' · ',
      h.a(
        [h.Href(lookRouter({ lookId: outfit.lookId })), ...styled(h, linkAction())],
        [format(locale, 'outfits.openLook', {})],
      ),
    ])
  const work = workOf(model, outfit.id)
  const isKeeping = Option.exists(work, CardWork.guards.Keeping)
  const isReplacing = Option.exists(work, CardWork.guards.Replacing)
  const problem = Option.flatMap(work, (doing) => Option.fromNullishOr(problemKey(doing)))
  return h.div(styled(h, styles.actions()), [
    actionButton(
      {
        label: format(locale, isKeeping ? 'outfits.keeping' : 'outfits.keep', {}),
        style: cx(primaryAction(), smallAction()),
        onClick: Message.ClickedKeep({
          outfitId: outfit.id,
          name: format(locale, 'outfits.lookName', { board: boardName, place: position + 1 }),
        }),
        isDisabled: isKeeping || isReplacing,
      },
      h,
    ),
    actionButton(
      {
        label: format(locale, isReplacing ? 'outfits.replacing' : 'outfits.another', {}),
        style: cx(secondaryAction(), smallAction()),
        onClick: Message.ClickedAnother({ outfitId: outfit.id }),
        isDisabled: isKeeping || isReplacing || !canReplace,
      },
      h,
    ),
    Option.match(problem, {
      onNone: () => h.empty,
      onSome: (key) => h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, key, {})]),
    }),
  ])
}

const cardView = (
  model: Model,
  outfit: BoardOutfit,
  position: number,
  canReplace: boolean,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    outfit.id,
    [...styled(h, styles.card())],
    [
      stillTable(
        flatLay(outfit.pieces),
        inputs.paper,
        [h.Role('img'), h.AriaLabel(format(inputs.locale, 'outfits.outfit', { place: position + 1 }))],
        h,
        sourceOf(outfit),
      ),
      actionsView(model, outfit, position, canReplace, inputs, h),
    ],
  )

/** The board's outfits as cards, with a line when the wardrobe made fewer than six or the anchor is gone; nothing on a
 * blank board. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  Option.match(model.maybeAround, {
    onNone: () => h.empty,
    onSome: ({ anchor, outfits }) =>
      h.section(
        [h.AriaLabelledBy('board-outfits'), ...styled(h, styles.section())],
        [
          h.h2([h.Id('board-outfits'), ...styled(h, styles.heading())], [format(inputs.locale, 'outfits.title', {})]),
          anchor === null
            ? h.p(styled(h, styles.note()), [format(inputs.locale, 'outfits.anchorGone', {})])
            : outfits.length < outfitsPerBoard
              ? h.p(styled(h, styles.note()), [format(inputs.locale, 'outfits.fewer', { count: outfits.length })])
              : h.empty,
          h.ul(
            styled(h, styles.cards()),
            outfits.map((outfit, position) => cardView(model, outfit, position, anchor !== null, inputs, h)),
          ),
        ],
      ),
  }),
)
