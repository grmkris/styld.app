import { cdn } from '../../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import { type BoardOutfit, flatLay, outfitsIn, type OutfitsAround, type Paper, PieceItem } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import { lookRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { CardWork, LayoutWork, Message, type Model, workOf } from './Outfits.ts'
import { type ImageSource, stillTable } from './Table.ts'
import * as styles from './OutfitsView.styles.ts'

/** What the cards are drawn with: the language, the board's name for a kept look's, and its paper. */
export interface Inputs {
  readonly locale: Locale
  readonly boardName: string
  readonly paper: Paper
}

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
  const isLaying = LayoutWork.guards.Laying(model.layout)
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
        isDisabled: isKeeping || isReplacing || isLaying,
      },
      h,
    ),
    actionButton(
      {
        label: format(locale, isReplacing ? 'outfits.replacing' : 'outfits.another', {}),
        style: cx(secondaryAction(), smallAction()),
        onClick: Message.ClickedAnother({ outfitId: outfit.id }),
        isDisabled: isKeeping || isReplacing || isLaying || !canReplace,
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

/** The heading, with Another layout beside it while the board's piece is there, and why it did not go through. */
const headView = (model: Model, { anchor }: OutfitsAround, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isLaying = LayoutWork.guards.Laying(model.layout)
  return h.div(styled(h, styles.head()), [
    h.h2([h.Id('board-outfits'), ...styled(h, styles.heading())], [format(locale, 'outfits.title', {})]),
    anchor === null
      ? h.empty
      : actionButton(
          {
            label: format(locale, isLaying ? 'outfits.layingOut' : 'outfits.anotherLayout', {}),
            style: cx(secondaryAction(), smallAction()),
            onClick: Message.ClickedAnotherLayout(),
            isDisabled: isLaying || model.cards.some(({ work }) => !CardWork.guards.Failed(work)),
          },
          h,
        ),
    LayoutWork.guards.Failed(model.layout)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'outfits.layoutFailed', {})])
      : h.empty,
  ])
}

/** The board's outfits as cards, with a line when the wardrobe made fewer than its layout holds or the anchor is gone;
 * nothing on a blank board. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  Option.match(model.maybeAround, {
    onNone: () => h.empty,
    onSome: (around) =>
      h.section(
        [h.AriaLabelledBy('board-outfits'), ...styled(h, styles.section())],
        [
          headView(model, around, inputs.locale, h),
          around.anchor === null
            ? h.p(styled(h, styles.note()), [format(inputs.locale, 'outfits.anchorGone', {})])
            : around.outfits.length < outfitsIn(around.layout)
              ? h.p(styled(h, styles.note()), [
                  format(inputs.locale, 'outfits.fewer', { count: around.outfits.length }),
                ])
              : h.empty,
          h.ul(
            styled(h, styles.cards()),
            around.outfits.map((outfit, position) =>
              cardView(model, outfit, position, around.anchor !== null, inputs, h),
            ),
          ),
        ],
      ),
  }),
)
