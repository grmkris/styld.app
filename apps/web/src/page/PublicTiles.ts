import { format, type Locale } from '@styld/i18n'
import type { Author, PublicBoardSummary, PublicLook, PublicPiece, PublicPin } from '@styld/protocol'
import { Array, Match } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { avatar } from '../Avatar.ts'
import { boardRouter, lookRouter, personRouter, publicPieceRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import * as boardStyles from './Board/PageView.styles.ts'
import { fromPublic, publicPicture, publicPieceImage } from './Board/Table.ts'
import { boardFace, type CoverPicture } from './BoardFace.ts'
import * as styles from './PublicTiles.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'
import { generatedMark } from './Board/MakeView.ts'
import { markedPicture } from './Board/MakeView.styles.ts'

// What others see, tile by tile: a byline, pieces, looks, boards and a public board's pins. Every picture comes from
// `/cdn/public`, which shows it only while its page is public.

/** Whose it is: their initials and name, linking to their profile. */
export const byline = <Message>(author: Author, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(personRouter({ handle: author.handle })), ...styled(h, styles.byline())],
    [avatar(author.name, author.tone, 'small', h), format(locale, 'share.byline', { name: author.name })],
  )

/** A piece's cut-out, linking to its page. */
export const pieceTile = <Message>(piece: PublicPiece, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [
      h.Href(publicPieceRouter({ pieceId: piece.id })),
      h.AriaLabel(pieceLabel(piece, locale)),
      ...styled(h, boardStyles.pinLink()),
    ],
    [
      h.span(styled(h, boardStyles.pinFrame()), [
        h.img([h.Src(publicPieceImage(piece.id)), h.Alt(''), h.Loading('lazy'), ...styled(h, boardStyles.cutout())]),
      ]),
    ],
  )

/** A look: its first four pieces two by two, and its name. */
export const lookTile = <Message>(look: PublicLook, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(lookRouter({ lookId: look.id })), ...styled(h, boardStyles.pinLink())],
    [
      h.span(styled(h, boardStyles.pinFrame()), [
        h.span(
          styled(h, boardStyles.mosaic()),
          Array.map(Array.take(look.pieces, 4), (piece) =>
            h.img([h.Src(publicPieceImage(piece.id)), h.Alt(''), h.Loading('lazy')]),
          ),
        ),
      ]),
      h.span(styled(h, boardStyles.pinName()), [look.name]),
    ],
  )

/** A pin on a public board. */
export const pinTile = <Message>(pin: PublicPin, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PublicPiecePin: ({ piece }) => pieceTile(piece, locale, h),
      PublicPicturePin: ({ imageId, generated }) =>
        h.span(styled(h, markedPicture()), [
          h.span(styled(h, boardStyles.pinFrame()), [
            h.img([
              h.Src(publicPicture(imageId, 'thumb')),
              h.Alt(format(locale, 'board.picture', {})),
              h.Loading('lazy'),
              ...styled(h, boardStyles.photo()),
            ]),
          ]),
          generated ? generatedMark(locale, h) : h.empty,
        ]),
      PublicLookPin: ({ look }) => lookTile(look, h),
    }),
  )

/** A grid of tiles, each keyed by its id. */
export const tileGrid = <Message>(
  tiles: ReadonlyArray<{ readonly id: string; readonly tile: Html }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.ul(
    styled(h, boardStyles.grid()),
    tiles.map(({ id, tile }) => h.keyed('li')(id, styled(h, boardStyles.pin()), [tile])),
  )

/** Where a pin's picture comes from inside a board's card, which is itself the link: a look shows its first piece. */
const coverSource = (pin: PublicPin): CoverPicture => ({
  id: pin.id,
  source: Match.value(pin).pipe(
    Match.tagsExhaustive({
      PublicPiecePin: ({ piece }) => publicPieceImage(piece.id),
      PublicPicturePin: ({ imageId }) => publicPicture(imageId, 'thumb'),
      PublicLookPin: ({ look }) => (look.pieces[0] === undefined ? '' : publicPieceImage(look.pieces[0].id)),
    }),
  ),
})

const card = <Message>(board: PublicBoardSummary, credit: Html, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(boardRouter({ boardId: board.id })), ...styled(h, styles.boardCard())],
    [
      boardFace(
        { items: board.items, paper: board.paper, cover: board.cover.map(coverSource), source: fromPublic },
        locale,
        h,
      ),
      h.span(styled(h, styles.boardName()), [board.name]),
      h.span(styled(h, styles.meta()), [format(locale, 'saveToBoard.pins', { count: board.pinCount })]),
      credit,
    ],
  )

/** A public board in a profile: its face, its name and how many pins. */
export const boardCard = <Message>(board: PublicBoardSummary, locale: Locale, h: HtmlBuilder<Message>): Html =>
  card(board, h.empty, locale, h)

/** A public board among other people's, as Explore shows it: the card, with whose it is under its meta. The card is
 * itself the link, so the credit is text; the board's page links to their profile. */
export const creditedBoardCard = <Message>(
  board: PublicBoardSummary,
  author: Author,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  card(
    board,
    h.span(styled(h, styles.credit()), [
      avatar(author.name, author.tone, 'small', h),
      format(locale, 'share.byline', { name: author.name }),
    ]),
    locale,
    h,
  )
