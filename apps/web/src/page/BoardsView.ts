import { cdn, piecesById } from '../Cdn.ts'
import { Button } from '@foldkit/ui'
import { format, type Locale } from '@styld/i18n'
import type { BoardSummary, Pin } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { addIcon, loader } from '../Icon.ts'
import { boardRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { boardImage, fromStyld, type ImageSource } from './Board/Table.ts'
import { boardFace, type CoverPicture } from './BoardFace.ts'
import { Creating, Message, type Model } from './Boards.ts'
import * as BoardStartView from './BoardStartView.ts'
import * as styles from './BoardsView.styles.ts'
import { roundAction, wideAction, wideLabel } from './PageHead.styles.ts'
import { savedView } from './SavedView.ts'
import { labMain } from './SectionMain.ts'
import type { BoardsData, PiecesData } from '../ServerData.ts'

/** Where a pin's picture comes from on its board's tile: a look shows its first piece. */
const coverSource = (pin: Pin): CoverPicture => ({
  id: pin.id,
  source: Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: ({ piece }) => cdn.piece(piece),
      PicturePin: (picture) => boardImage(picture, 'thumb'),
      LookPin: ({ look }) => (look.pieces[0] === undefined ? '' : cdn.piece(look.pieces[0])),
    }),
  ),
})

const tileView = (board: BoardSummary, source: ImageSource, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    board.id,
    [],
    [
      h.a(
        [h.Href(boardRouter({ boardId: board.id })), ...styled(h, styles.tile())],
        [
          boardFace({ items: board.items, paper: board.paper, cover: board.cover.map(coverSource), source }, locale, h),
          h.span(styled(h, styles.tileName()), [board.name]),
          h.span(styled(h, styles.tileMeta()), [format(locale, 'studio.pinCount', { count: board.pinCount })]),
        ],
      ),
    ],
  )

/** The round + at the top of the page: a board under the default name, opened at once to be filled and renamed. On a
 * wide screen it says so, as Wardrobe's Add clothes does. */
const newBoardAction = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Creating.guards.Sending(model.creating)
  return Button.view(
    {
      onClick: Message.ClickedNewBoard(),
      isDisabled: sending,
      toView: (attributes) =>
        h.button(
          [...attributes.button, ...styled(h, cx(primaryAction(), roundAction(), wideAction()))],
          [
            sending ? loader(h) : addIcon(h),
            h.span(styled(h, wideLabel()), [format(locale, sending ? 'boards.creating' : 'boards.new', {})]),
          ],
        ),
    },
    h,
  )
}

const skeletonTiles = ['a', 'b'] as const

/** The shape of what is coming: board tiles with their paper, a name and a line. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'boards.loading', {})]),
      h.ul(
        [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.grid())],
        skeletonTiles.map((slot) =>
          h.keyed('li')(slot, styled(h, styles.tile()), [
            h.span(styled(h, cx(block(), styles.paperSkeleton()))),
            h.span(styled(h, cx(line(), styles.nameSkeleton()))),
            h.span(styled(h, cx(line(), styles.metaSkeleton()))),
          ]),
        ),
      ),
    ],
  )

const listView = (boards: BoardsData, source: ImageSource, locale: Locale, h: HtmlBuilder<Message>): Html =>
  AsyncData.matchData(boards, {
    onEmpty: () => loadingView(locale, h),
    onFailure: () =>
      h.div(styled(h, styles.head()), [
        h.p([h.Role('alert')], [format(locale, 'boards.failed', {})]),
        actionButton(
          { label: format(locale, 'boards.retry', {}), style: cx(secondaryAction()), onClick: Message.ClickedRetry() },
          h,
        ),
      ]),
    onData: (list) =>
      Array.match(list, {
        onEmpty: () => h.p(styled(h, styles.note()), [format(locale, 'boards.empty', {})]),
        onNonEmpty: (some) =>
          h.ul(
            styled(h, styles.grid()),
            Array.map(some, (board) => tileView(board, source, locale, h)),
          ),
      }),
  })

/** The Boards page; its boards are the app's, as last read, their tables' pieces from the person's pieces. */
export const view = Submodel.defineView<
  Model,
  Message,
  { readonly locale: Locale; readonly boards: BoardsData; readonly pieces: PiecesData }
>((model, { locale, boards, pieces }, h) =>
  labMain(
    'boards',
    styles.page(),
    Option.some(newBoardAction(model, locale, h)),
    [
      h.div(styled(h, styles.head()), [
        h.p(styled(h, styles.intro()), [format(locale, 'boards.intro', {})]),
        Creating.guards.Failed(model.creating)
          ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'boards.createFailed', {})])
          : h.empty,
      ]),
      listView(boards, fromStyld(piecesById(Option.getOrElse(AsyncData.getData(pieces), () => []))), locale, h),
      savedView(model.saved, locale, Message.ClickedRetrySaved(), h),
      h.submodel({
        slotId: 'boards-start',
        model: model.start,
        view: BoardStartView.view,
        viewInputs: { locale, pieces },
        toParentMessage: (message) => Message.GotStartMessage({ message }),
      }),
    ],
    locale,
    h,
  ),
)
