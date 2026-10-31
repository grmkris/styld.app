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
import { boardImage, pieceImage } from './Board/Table.ts'
import { boardFace, type CoverPicture } from './BoardFace.ts'
import { Creating, Message, type Model } from './Boards.ts'
import * as styles from './BoardsView.styles.ts'
import { pageHead, pageTitle } from './PageHead.ts'
import { roundAction, wideAction, wideLabel } from './PageHead.styles.ts'
import { savedView } from './SavedView.ts'

/** Where a pin's picture comes from on its board's tile: a look shows its first piece. */
const coverSource = (pin: Pin): CoverPicture => ({
  id: pin.id,
  source: Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: ({ piece }) => pieceImage(piece.id),
      PicturePin: ({ imageId }) => boardImage(imageId, 'thumb'),
      LookPin: ({ look }) => (look.pieces[0] === undefined ? '' : pieceImage(look.pieces[0].id)),
    }),
  ),
})

const tileView = (board: BoardSummary, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    board.id,
    [],
    [
      h.a(
        [h.Href(boardRouter({ boardId: board.id })), ...styled(h, styles.tile())],
        [
          boardFace({ items: board.items, paper: board.paper, cover: board.cover.map(coverSource) }, locale, h),
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
      onClick: Message.ClickedNewBoard({ defaultName: format(locale, 'boards.defaultName', {}) }),
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

const listView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  AsyncData.matchData(model.boards, {
    onEmpty: () => loadingView(locale, h),
    onFailure: () =>
      h.div(styled(h, styles.head()), [
        h.p([h.Role('alert')], [format(locale, 'boards.failed', {})]),
        actionButton(
          { label: format(locale, 'boards.retry', {}), style: cx(secondaryAction()), onClick: Message.ClickedRetry() },
          h,
        ),
      ]),
    onData: (boards) =>
      Array.match(boards, {
        onEmpty: () => h.p(styled(h, styles.note()), [format(locale, 'boards.empty', {})]),
        onNonEmpty: (some) =>
          h.ul(
            styled(h, styles.grid()),
            Array.map(some, (board) => tileView(board, locale, h)),
          ),
      }),
  })

export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.page())],
    [
      h.div(styled(h, styles.head()), [
        pageHead(pageTitle(format(locale, 'boards.title', {}), h), Option.some(newBoardAction(model, locale, h)), h),
        h.p(styled(h, styles.intro()), [format(locale, 'boards.intro', {})]),
        Creating.guards.Failed(model.creating)
          ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'boards.createFailed', {})])
          : h.empty,
      ]),
      listView(model, locale, h),
      savedView(model.saved, locale, h),
    ],
  ),
)
