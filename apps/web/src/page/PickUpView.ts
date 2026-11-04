import { cdn, type PieceImagesById, piecesById } from '../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import type { BoardItem, BoardSummary } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { secondaryAction, smallAction } from '../Actions.styles.ts'
import { boardRouter, photoRouter, reviewRouter } from '../route.ts'
import type { BoardsData, PiecesData } from '../ServerData.ts'
import { styled } from '../Styled.ts'
import { fromStyld, stillTable } from './Board/Table.ts'
import type { Model } from './PickUp.ts'
import * as styles from './PickUpView.styles.ts'

// Home's "Pick up where you left off": a favourite outfit to wear again, the pieces waiting in the tray and the last
// board with something on it. Every card is a link, so the view needs no Messages of its own.

/** Nothing is asked for yet, or the first answer is on its way. */
const isPending = (data: AsyncData.AsyncData<unknown, unknown>) => AsyncData.isIdle(data) || AsyncData.isLoading(data)

/** A window's top on the 1250-unit table: from its top to half way, where the 625-unit window ends at the foot. */
const clamp = (top: number) => Math.min(Math.max(top, 0), 625)

/** How far down a board's 4:5 table its 16:10 window on Home starts, as a share of the table's height (0 to a half),
 * so the window centres on what lies there. A table is 1250 units tall and the window 625.
 */
export const cropFrom = (items: ReadonlyArray<BoardItem>): number => windowTop(items) / 1250

/** Whether an item lies whole inside the 625-unit window starting at `top`. */
const inWindow = (top: number) => (item: BoardItem) =>
  item.y - item.size / 2 >= top && item.y + item.size / 2 <= top + 625

/** The window's top in table units: the one that holds the most items whole, so no piece shows as a sliver; of those,
 * the nearest the middle of what lies there. */
const windowTop = (items: ReadonlyArray<BoardItem>): number =>
  Array.match(items, {
    onEmpty: () => 312.5,
    onNonEmpty: (some) => {
      const upper = Math.min(...some.map((item) => item.y - item.size / 2))
      const lower = Math.max(...some.map((item) => item.y + item.size / 2))
      const centred = clamp((upper + lower) / 2 - 312.5)
      const whole = (top: number) => some.filter(inWindow(top)).length
      const candidates = [centred, 0, 625, ...some.map((item) => clamp(item.y - item.size / 2))]
      return candidates.reduce((chosen, top) => {
        const gain = whole(top) - whole(chosen)
        return gain > 0 || (gain === 0 && Math.abs(top - centred) < Math.abs(chosen - centred)) ? top : chosen
      })
    },
  })

/** What the window draws: the items it holds whole, so none is cut at its edges; all of them if none fits whole. */
const inView = (items: ReadonlyArray<BoardItem>) => {
  const whole = items.filter(inWindow(windowTop(items)))
  return whole.length === 0 ? items : whole
}

/** One way to pick up: what it is, then its action at the card's foot, which the title describes. */
const pickUpCard = <Message>(
  id: string,
  title: string,
  action: { readonly href: string; readonly label: string },
  picture: Html,
  h: HtmlBuilder<Message>,
): Html =>
  h.article(styled(h, styles.card()), [
    picture,
    h.p([h.Id(id), ...styled(h, styles.cardTitle())], [title]),
    h.a(
      [
        h.Href(action.href),
        h.AriaDescribedBy(id),
        ...styled(h, cx(secondaryAction(), smallAction(), styles.cardAction())),
      ],
      [action.label],
    ),
  ])

const boardCard = <Message>(
  board: BoardSummary,
  pieces: PieceImagesById,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  pickUpCard(
    'pick-up-board',
    board.name,
    { href: boardRouter({ boardId: board.id }), label: format(locale, 'today.keepGoing', {}) },
    h.div(
      [h.Style({ '--crop': String(cropFrom(board.items)) }), ...styled(h, styles.boardCrop())],
      [stillTable(inView(board.items), board.paper, [], h, fromStyld(pieces))],
    ),
    h,
  )

/** The first found pieces waiting in the tray, side by side on paper in the board card's 16:10 window. */
const trayPictures = <Message>(pictures: ReadonlyArray<string>, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.AriaHidden(true), ...styled(h, styles.trayThumbs())],
    pictures.map((source) => h.img([h.Src(source), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.trayThumb())])),
  )

/** What the app holds that Home shows: the pieces, and the boards it picks the last one from. */
export type HomeData = { readonly pieces: PiecesData; readonly boards: BoardsData }

/** The newest board with something on its table: an empty one is nothing to pick up. */
const lastBoard = (boards: BoardsData): Option.Option<BoardSummary> =>
  Option.flatMap(AsyncData.getData(boards), (list) => Array.findFirst(list, (board) => board.items.length > 0))

/** Where they left off, drawn once the table and its own answers are in, so it arrives in one piece below them. */
export const pickUpView = <Message>(model: Model, data: HomeData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if ([data.pieces, data.boards, model.favourite, model.tray].some(isPending)) return h.empty
  const tray = Option.getOrElse(AsyncData.getData(model.tray), () => ({ waiting: 0, pictures: [] }))
  const cards = [
    ...Option.match(Option.flatten(AsyncData.getData(model.favourite)), {
      onNone: () => [],
      onSome: (photo) => [
        pickUpCard(
          'pick-up-photo',
          format(locale, 'today.lovedOutfit', {}),
          { href: photoRouter({ photoId: photo.id }), label: format(locale, 'photo.wearAgain', {}) },
          h.img([h.Src(cdn.photo(photo, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.photoCrop())]),
          h,
        ),
      ],
    }),
    ...(tray.waiting > 0
      ? [
          pickUpCard(
            'pick-up-tray',
            format(locale, 'today.waiting', { count: tray.waiting }),
            { href: reviewRouter({}), label: format(locale, 'today.review', {}) },
            trayPictures(tray.pictures, h),
            h,
          ),
        ]
      : []),
    ...Option.match(lastBoard(data.boards), {
      onNone: () => [],
      onSome: (board) => [
        boardCard(board, piecesById(Option.getOrElse(AsyncData.getData(data.pieces), () => [])), locale, h),
      ],
    }),
  ]
  return Array.match(cards, {
    onEmpty: () => h.empty,
    onNonEmpty: (some) =>
      h.section(
        [h.AriaLabelledBy('pick-up'), ...styled(h, styles.pickUp())],
        [h.h2([h.Id('pick-up')], [format(locale, 'today.pickUp', {})]), h.div(styled(h, styles.cards()), some)],
      ),
  })
}
