import { textLength, prices } from '@styld/protocol'
import type { Piece, PiecePicture } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { Choosing, Message, type Model, type Redraw, RedrawSend } from './Piece.ts'
import * as styles from './PieceView.styles.ts'

// A piece's clean picture on its page: where its drawing stands, which picture shows, and redrawing it.

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
      h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.picture.redrawCost', { credits: prices.redraw })]),
      RedrawSend.guards.Failed(redraw.send)
        ? h.p(
            [h.Role('alert'), ...styled(h, formError())],
            [format(locale, `wardrobe.picture.problem.${redraw.send.problem}`, {})],
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

/** What the owner can do with the picture it shows: swap it for the other one, redraw. */
const pictureChoices = (picture: PiecePicture, model: Model, locale: Locale, h: HtmlBuilder<Message>) => {
  const choose = (use: 'clean' | 'photo', key: 'wardrobe.picture.showPhoto' | 'wardrobe.picture.showClean') =>
    actionButton(
      {
        label: format(locale, key, {}),
        style: secondaryAction(),
        onClick: Message.ClickedShowPicture({ use }),
        isDisabled: Choosing.guards.Sending(model.choosing),
      },
      h,
    )
  return [
    picture.state === 'ready' && picture.shows === 'clean' ? choose('photo', 'wardrobe.picture.showPhoto') : h.empty,
    picture.state === 'ready' && picture.shows === 'photo' ? choose('clean', 'wardrobe.picture.showClean') : h.empty,
    actionButton(
      {
        label: format(locale, 'wardrobe.picture.redraw', {}),
        style: secondaryAction(),
        onClick: Message.ClickedRedraw(),
      },
      h,
    ),
  ]
}

const pictureStatus = (picture: PiecePicture, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (picture.state === 'drawing')
    return h.p(
      [h.Role('status'), ...styled(h, styles.status())],
      [loader(h), format(locale, 'wardrobe.picture.drawing', {})],
    )
  if (picture.state === 'retake' || picture.state === 'failed')
    return h.p(styled(h, styles.pictureNote()), [format(locale, `wardrobe.picture.${picture.state}`, {})])
  return picture.shows === 'clean'
    ? h.p(styled(h, styles.cleanedLabel()), [format(locale, 'wardrobe.picture.cleaned', {})])
    : h.empty
}

/** The piece's clean picture: none for a piece that never had one asked for. */
export const picturePanel = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const picture = piece.picture
  if (picture === undefined) return h.empty
  return h.section(
    [h.AriaLabel(format(locale, 'wardrobe.picture.cleaned', {})), ...styled(h, styles.picturePanel())],
    [
      pictureStatus(picture, locale, h),
      Choosing.guards.Failed(model.choosing)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.picture.chooseFailed', {})])
        : h.empty,
      Option.match(model.redraw, {
        onNone: () =>
          picture.state === 'drawing'
            ? h.empty
            : h.div(styled(h, styles.actions()), pictureChoices(picture, model, locale, h)),
        onSome: (redraw) => redrawForm(redraw, locale, h),
      }),
    ],
  )
}
