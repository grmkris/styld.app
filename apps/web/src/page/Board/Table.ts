import type { BoardItem, Paper } from '@styld/protocol'
import { ImageItem, PieceItem, TextItem } from '@styld/protocol'
import { Array, Schema } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { styled } from '../../Styled.ts'
import { baseSize } from './Geometry.ts'
import * as styles from './View.styles.ts'

// The table as a picture: pieces, text and pictures laid on paper. The board editor adds hands to it; Boards
// and Home show it as it is.

export const pieceImage = (pieceId: string) => `/cdn/pieces/${pieceId}/thumb`
const boardImage = (imageId: string, size: 'thumb' | 'full' = 'full') => `/cdn/boards/images/${imageId}/${size}`

/** Where an item lies, as the custom properties its styles read. The browser sets them through the CSSOM
 * after the data loads; the edge CSP would refuse them as an inline attribute in server-rendered HTML. */
export const placement = (item: BoardItem) => ({
  '--x': String(item.x),
  '--y': String(item.y),
  '--k': String(item.size / baseSize),
  '--r': `${String(item.turn)}deg`,
  '--flip': item.flipped ? '-1' : '1',
  zIndex: String(item.z),
})

export const itemContent = <Message>(
  item: BoardItem,
  h: HtmlBuilder<Message>,
  size: 'thumb' | 'full' = 'full',
): Html => {
  if (Schema.is(PieceItem)(item))
    return h.img([h.Src(pieceImage(item.pieceId)), h.Alt(''), h.Draggable(false), ...styled(h, styles.cutout())])
  if (Schema.is(TextItem)(item))
    return h.span([h.DataAttribute('style', item.style), ...styled(h, styles.label())], [item.text])
  return Schema.is(ImageItem)(item)
    ? h.img([h.Src(boardImage(item.imageId, size)), h.Alt(''), h.Draggable(false), ...styled(h, styles.picture())])
    : h.empty
}

/** An item's frame: square for a piece or a picture, the text's own shape for a label. */
export const itemStyle = (item: BoardItem) =>
  Schema.is(TextItem)(item) ? cx(styles.item(), styles.words()) : cx(styles.item(), styles.square())

/** A still table: its paper and items, with no hands on it. `attributes` must not carry a class: an element
 * takes one class attribute, and the paper's is set here. */
export const stillTable = <Message>(
  items: ReadonlyArray<BoardItem>,
  paper: Paper,
  attributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.DataAttribute('paper', paper), ...styled(h, cx(styles.paper(), styles.still())), ...attributes],
    Array.map(items, (item) =>
      h.keyed('div')(
        item.id,
        [h.AriaHidden(true), ...styled(h, itemStyle(item)), h.Style(placement(item))],
        [itemContent(item, h, 'thumb')],
      ),
    ),
  )
