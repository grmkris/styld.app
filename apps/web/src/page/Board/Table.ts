import { cdn, type PieceImagesById } from '../../Cdn.ts'
import type { BoardItem, ImageItem, Paper } from '@styld/protocol'
import { PieceItem, TextItem } from '@styld/protocol'
import { Array, Schema } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { styled } from '../../Styled.ts'
import { baseSize } from './Geometry.ts'
import * as styles from './View.styles.ts'

// The table as a picture: pieces, text and pictures laid on paper. The board editor adds hands to it; Boards
// and Home show it as it is.

export const boardImage = cdn.boardImage

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

/** Where a piece's or a picture's image comes from: Styld's own routes on the website, data URLs inside an
 * assistant's sandboxed view. None draws nothing. */
export type ImageSource = (item: PieceItem | ImageItem, size: 'thumb' | 'full') => string | undefined

/** The person's own table: its pieces' signed addresses from the pieces at hand, its pictures from Styld's route. */
export const fromStyld =
  (pieces: PieceImagesById): ImageSource =>
  (item, size) =>
    Schema.is(PieceItem)(item) ? pieces.get(item.pieceId)?.thumb : boardImage(item.imageId, size)

/** What others see of a public board: its pieces' and pictures' public addresses. */
export const publicPieceImage = (pieceId: string, size: 'thumb' | 'full' = 'thumb') => cdn.publicPiece(pieceId, size)
export const publicPicture = (imageId: string, size: 'thumb' | 'full' = 'full') => cdn.publicPicture(imageId, size)
export const fromPublic: ImageSource = (item, size) =>
  Schema.is(PieceItem)(item) ? publicPieceImage(item.pieceId) : publicPicture(item.imageId, size)

export const itemContent = <Message>(
  item: BoardItem,
  h: HtmlBuilder<Message>,
  size: 'thumb' | 'full',
  source: ImageSource,
): Html => {
  if (Schema.is(TextItem)(item))
    return h.span([h.DataAttribute('style', item.style), ...styled(h, styles.label())], [item.text])
  const image = source(item, size)
  if (image === undefined) return h.empty
  return h.img([
    h.Src(image),
    h.Alt(''),
    h.Draggable(false),
    ...styled(h, Schema.is(PieceItem)(item) ? styles.cutout() : styles.picture()),
  ])
}

/** An item's frame: square for a piece or picture, fitted to the words for a label. */
export const itemStyle = (item: BoardItem) => {
  if (Schema.is(TextItem)(item)) return cx(styles.item(), styles.words())
  return cx(styles.item(), styles.square())
}

/** A still table: its paper and items, with no hands on it. `attributes` must not carry a class: an element
 * takes one class attribute, and the paper's is set here. */
export const stillTable = <Message>(
  items: ReadonlyArray<BoardItem>,
  paper: Paper,
  attributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
  source: ImageSource,
): Html =>
  h.div(
    [h.DataAttribute('paper', paper), ...styled(h, cx(styles.paper(), styles.still())), ...attributes],
    Array.map(items, (item) =>
      h.keyed('div')(
        item.id,
        [h.AriaHidden(true), ...styled(h, itemStyle(item)), h.Style(placement(item))],
        [itemContent(item, h, 'thumb', source)],
      ),
    ),
  )
