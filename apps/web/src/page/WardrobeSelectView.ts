import { cdn } from '../Cdn.ts'
import type { Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { Deletion, confirmActions } from '../Confirm.ts'
import { chip } from '../Controls.styles.ts'
import { formError } from '../Fields.styles.ts'
import { checkIcon } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { Message, Model } from './WardrobeSelect.ts'
import { pieceLabel } from './WardrobeWords.ts'
import * as styles from './WardrobeSelectView.styles.ts'
import { grid } from './WardrobeView.styles.ts'

// Select mode's parts on a type's page: the chip that starts and ends it, and the grid of ticks with the bar that
// deletes them and the question it asks first.

type On = Extract<Model, { readonly _tag: 'On' }>

/** Select beside Filters, or Done in its place while selecting. */
export const toggle = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  actionButton(
    {
      label: format(locale, Model.guards.On(model) ? 'wardrobe.selectDone' : 'wardrobe.select', {}),
      style: chip(),
      onClick: Model.guards.On(model) ? Message.ClickedDone() : Message.ClickedSelect(),
    },
    h,
  ),
)

/** A piece as a tick: its picture, pressed once ticked, with the check over its corner. */
const tick = (piece: Piece, selection: On, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isTicked = selection.pieceIds.includes(piece.id)
  return h.keyed('li')(
    piece.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(isTicked ? 'true' : 'false'),
          h.AriaLabel(pieceLabel(piece, locale)),
          h.OnClick(Message.ToggledPiece({ pieceId: piece.id })),
          ...styled(h, styles.tick()),
        ],
        [
          h.img([h.Src(cdn.piece(piece, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.tickImage())]),
          isTicked ? h.span(styled(h, styles.ticked()), [checkIcon(h)]) : h.empty,
        ],
      ),
    ],
  )
}

/** The one question before the pieces go, in the page: how many, what they leave, and that it is for good. */
const question = (selection: On, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const deleting = Deletion.guards.Deleting(selection.deletion)
  const count = selection.pieceIds.length
  return h.section(
    [h.Role('alertdialog'), h.AriaLabelledBy('delete-selected-question'), ...styled(h, styles.bar())],
    [
      h.p(
        [h.Id('delete-selected-question'), ...styled(h, styles.question())],
        [format(locale, 'wardrobe.deleteSelectedConfirm', { count })],
      ),
      Deletion.guards.Failed(selection.deletion)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.deleteSelectedFailed', {})])
        : h.empty,
      h.div(
        styled(h, styles.barActions()),
        confirmActions(
          {
            confirm: format(locale, 'wardrobe.deleteSelected', { count }),
            cancel: format(locale, 'common.cancel', {}),
            onConfirm: Message.ClickedConfirmDelete(),
            onCancel: Message.ClickedCancelDelete(),
            busy: deleting,
          },
          h,
        ),
      ),
    ],
  )
}

/** The bar above the tab bar: delete the ticked pieces, or stop selecting. */
const bar = (selection: On, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const count = selection.pieceIds.length
  return h.div(styled(h, styles.bar()), [
    count === 0 ? h.p(styled(h, styles.hint()), [format(locale, 'wardrobe.selectPiece', {})]) : h.empty,
    h.div(styled(h, styles.barActions()), [
      actionButton(
        {
          label: format(locale, 'wardrobe.deleteSelected', { count }),
          style: primaryAction(),
          onClick: Message.ClickedDelete(),
          isDisabled: count === 0,
        },
        h,
      ),
      actionButton(
        { label: format(locale, 'wardrobe.selectDone', {}), style: secondaryAction(), onClick: Message.ClickedDone() },
        h,
      ),
    ]),
  ])
}

/** The type's pieces as ticks while selecting, with the bar, or the question once Delete is pressed. */
export const ticks = Submodel.defineView<
  Model,
  Message,
  { readonly pieces: ReadonlyArray<Piece>; readonly locale: Locale }
>((model, { pieces, locale }, h) =>
  Model.match(model, {
    Off: () => h.empty,
    On: (selection) =>
      h.div(styled(h, styles.selecting()), [
        h.ul(
          styled(h, cx(grid(), styles.tickGrid())),
          pieces.map((piece) => tick(piece, selection, locale, h)),
        ),
        Deletion.guards.Idle(selection.deletion) ? bar(selection, locale, h) : question(selection, locale, h),
      ]),
  }),
)
