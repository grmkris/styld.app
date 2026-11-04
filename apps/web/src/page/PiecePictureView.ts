import { textLength } from '@styld/protocol'
import type { Piece, PiecePicture } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { Message, type Model, type Redraw, RedrawSend } from './Piece.ts'
import * as styles from './PieceView.styles.ts'
import { spentWords } from './MoreCredits.ts'

// A piece's clean picture on its page, below its pictures: why none came of it, and redrawing it.

const redrawForm = (redraw: Redraw, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = RedrawSend.guards.Sending(redraw.send)
  return h.form(
    [h.OnSubmit(Message.SubmittedRedraw()), h.AriaBusy(sending), ...styled(h, styles.editForm())],
    [
      h.label([h.For('picture-hint'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.picture.hintLabel', {})]),
      h.input([
        h.Id('picture-hint'),
        h.Name('hint'),
        h.Type('text'),
        h.Maxlength(textLength.hint),
        h.Value(redraw.hint),
        h.Placeholder(format(locale, 'wardrobe.picture.hintPlaceholder', {})),
        h.OnInput((value) => Message.UpdatedHint({ value })),
        ...styled(h, textField()),
      ]),
      h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.picture.redrawFree', {})]),
      RedrawSend.guards.Failed(redraw.send)
        ? h.p(
            [h.Role('alert'), ...styled(h, formError())],
            spentWords(
              format(locale, `wardrobe.picture.problem.${redraw.send.problem}`, {}),
              redraw.send.problem === 'dailyLimit',
              locale,
              h,
            ),
          )
        : h.empty,
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.picture.redraw', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: sending,
            leading: sending ? loader(h) : h.empty,
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'common.cancel', {}),
            style: secondaryAction(),
            onClick: Message.ClickedCancelRedraw(),
            isDisabled: sending,
          },
          h,
        ),
      ]),
    ],
  )
}

/** Where the drawing stands when none came of it: a retake asked for, or no drawing at all. */
const pictureStatus = (picture: PiecePicture, locale: Locale, h: HtmlBuilder<Message>): Html =>
  picture.state === 'retake' || picture.state === 'failed'
    ? h.p(styled(h, styles.pictureNote()), [format(locale, `wardrobe.picture.${picture.state}`, {})])
    : h.empty

/** The piece's shop-style picture below its pictures: why there is none, and redrawing it, for a credit. While a
 * drawing is being made its slide says so (`PieceCarouselView.ts`), and nothing waits here. None for a piece that
 * never had one asked for. */
export const picturePanel = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const picture = piece.picture
  if (picture === undefined || (picture.state === 'drawing' && Option.isNone(model.redraw))) return h.empty
  return h.section(
    [h.AriaLabel(format(locale, 'wardrobe.picture.clean', {})), ...styled(h, styles.picturePanel())],
    [
      pictureStatus(picture, locale, h),
      Option.match(model.redraw, {
        onNone: () =>
          h.div(styled(h, styles.actions()), [
            actionButton(
              {
                label: format(locale, 'wardrobe.picture.redraw', {}),
                style: secondaryAction(),
                onClick: Message.ClickedRedraw(),
              },
              h,
            ),
          ]),
        onSome: (redraw) => redrawForm(redraw, locale, h),
      }),
    ],
  )
}
