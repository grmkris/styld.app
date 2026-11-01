import { prices } from '@styld/protocol'
import type { Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Submodel } from 'foldkit'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, secondaryAction } from '../Actions.styles.ts'
import { formError } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { chip } from './AskView.styles.ts'
import { chosen } from './ExploreView.styles.ts'
import { Message, type Model } from './PieceBack.ts'
import * as styles from './PieceView.styles.ts'

type Inputs = { readonly piece: Piece; readonly locale: Locale }

/** Front and Back under the picture, once the piece has a back. */
export const sides = Submodel.defineView<Model, Message, Inputs>((model, { piece, locale }, h) =>
  piece.hasBack
    ? h.div(
        [h.Role('group'), h.AriaLabel(format(locale, 'wardrobe.sides', {})), ...styled(h, styles.sides())],
        (['front', 'back'] as const).map((side) =>
          h.button(
            [
              h.Type('button'),
              h.AriaPressed(String(model.side === side)),
              h.OnClick(Message.ClickedSide({ side })),
              ...styled(h, cx(chip(), chosen())),
            ],
            [format(locale, side === 'front' ? 'wardrobe.front' : 'wardrobe.back', {})],
          ),
        ),
      )
    : h.empty,
)

/** Adding, replacing or removing the piece's back: a picked photo is cut out like the front, for a credit. */
export const actions = Submodel.defineView<Model, Message, Inputs>((model, { piece, locale }, h) => {
  if (piece.status !== 'ready') return h.empty
  const sending = model.work === 'sending'
  return h.div(styled(h, styles.backPanel()), [
    sending
      ? h.p([h.Role('status'), ...styled(h, styles.status())], [loader(h), format(locale, 'wardrobe.backSending', {})])
      : h.div(styled(h, styles.backActions()), [
          h.label(
            [h.For('piece-back'), ...styled(h, cx(secondaryAction(), styles.fileAction()))],
            [
              format(locale, piece.hasBack ? 'wardrobe.replaceBack' : 'wardrobe.addBack', {}),
              h.input([
                h.Id('piece-back'),
                h.Type('file'),
                h.Accept('image/*'),
                h.AriaDescribedBy('piece-back-cost'),
                h.OnFileChange((files) => Message.ChoseBack({ files })),
                ...styled(h, visuallyHidden()),
              ]),
            ],
          ),
          piece.hasBack
            ? actionButton(
                {
                  label: format(locale, 'wardrobe.removeBack', {}),
                  style: linkAction(),
                  onClick: Message.ClickedRemoveBack(),
                },
                h,
              )
            : h.empty,
        ]),
    h.p(
      [h.Id('piece-back-cost'), ...styled(h, styles.pictureNote())],
      [format(locale, 'wardrobe.backCost', { credits: prices.photo })],
    ),
    model.work === 'failed'
      ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.backFailed', {})])
      : h.empty,
  ])
})
