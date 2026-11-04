import { format, type Locale } from '@styld/i18n'
import { ImageItem, PieceItem, PicturePin } from '@styld/protocol'
import { Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { PiecesData } from '../../ServerData.ts'
import { styled } from '../../Styled.ts'
import { piecePickerSheet } from '../PiecePickerView.ts'
import * as pickerStyles from '../PiecePickerView.styles.ts'
import { Message } from './Message.ts'
import type { Model } from './Model.ts'
import * as styles from './PageView.styles.ts'
import { boardImage } from './Table.ts'

/** Pinned pictures can be put back without scrolling through the wardrobe. */
const pictures = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const placed = new Set(model.items.flatMap((item) => (Schema.is(ImageItem)(item) ? [item.imageId] : [])))
  const offTable = model.pins.filter(Schema.is(PicturePin)).filter((pin) => !placed.has(pin.imageId))
  return offTable.length === 0
    ? h.empty
    : h.ul(
        styled(h, styles.pickGrid()),
        offTable.map((pin) =>
          h.keyed('li')(
            pin.id,
            [],
            [
              h.button(
                [
                  h.Type('button'),
                  h.AriaLabel(format(locale, 'board.placePicture', {})),
                  ...styled(h, styles.pick()),
                  h.OnClick(Message.ClickedPinnedPicture({ imageId: pin.imageId })),
                ],
                [
                  h.img([
                    h.Src(boardImage(pin, 'thumb')),
                    h.Alt(''),
                    h.Loading('lazy'),
                    ...styled(h, pickerStyles.image()),
                  ]),
                ],
              ),
            ],
          ),
        ),
      )
}

/** "Add your piece": the wardrobe's pieces, a piece on the table ticked (choosing it selects it), then the board's
 * pictures that are off the table. */
export const piecePickerView = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  piecePickerSheet(
    {
      picker: model.piecePicker,
      pieces,
      locale,
      title: format(locale, 'board.addYourPiece', {}),
      emptyWardrobe: format(locale, 'board.wardrobeEmpty', {}),
      messages: {
        sheet: (message) => Message.GotPiecePickerMessage({ message }),
        group: (group) => Message.SelectedPickerGroup({ group }),
        type: (type) => Message.SelectedPickerType({ type }),
        query: (query) => Message.UpdatedPickerQuery({ query }),
        piece: ({ id }) => Message.ClickedWardrobePiece({ pieceId: id }),
      },
      isChosen: (piece) => model.items.some((item) => Schema.is(PieceItem)(item) && item.pieceId === piece.id),
      pieceLabel: (name, onTable) => format(locale, onTable ? 'board.selectPiece' : 'board.addPiece', { name }),
      after: [pictures(model, locale, h)],
    },
    h,
  )
