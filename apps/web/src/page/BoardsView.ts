import { format, type Locale } from '@styld/i18n'
import type { BoardSummary } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { textField } from '../Fields.styles.ts'
import { addIcon, loader } from '../Icon.ts'
import { boardRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { stillTable } from './Board/Table.ts'
import { Creating, Message, type Model } from './Boards.ts'
import * as styles from './BoardsView.styles.ts'
import { pageHead, pageTitle } from './PageHead.ts'

const tileView = (board: BoardSummary, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    board.id,
    [],
    [
      h.a(
        [
          h.Href(boardRouter({ boardId: board.id })),
          h.AriaLabel(format(locale, 'boards.open', { name: board.name })),
          ...styled(h, styles.tile()),
        ],
        [
          stillTable(board.items, board.paper, [], h),
          h.span(styled(h, styles.tileName()), [board.name]),
          h.span(styled(h, styles.tileMeta()), [format(locale, 'studio.pinCount', { count: board.pinCount })]),
        ],
      ),
    ],
  )

const createForm = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Creating.guards.Sending(model.creating)
  return h.form(
    [
      ...styled(h, styles.create()),
      h.OnSubmit(Message.SubmittedNewBoard({ defaultName: format(locale, 'boards.defaultName', {}) })),
      h.AriaBusy(sending),
      h.Attribute('novalidate', ''),
    ],
    [
      h.label(
        [h.For('board-name'), ...styled(h, styles.nameField())],
        [
          format(locale, 'boards.name', {}),
          h.input([
            h.Id('board-name'),
            ...styled(h, textField()),
            h.Placeholder(format(locale, 'boards.defaultName', {})),
            h.Value(model.name),
            h.Attribute('maxlength', '60'),
            h.Readonly(sending),
            h.OnInput((value) => Message.UpdatedName({ value })),
          ]),
        ],
      ),
      actionButton(
        {
          label: format(locale, sending ? 'boards.creating' : 'boards.new', {}),
          style: primaryAction(),
          type: 'submit',
          isDisabled: sending,
          leading: sending ? loader(h) : addIcon(h),
        },
        h,
      ),
      Creating.guards.Failed(model.creating)
        ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'boards.createFailed', {})])
        : h.empty,
    ],
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
        pageHead(pageTitle(format(locale, 'boards.title', {}), h), Option.none(), h),
        h.p(styled(h, styles.intro()), [format(locale, 'boards.intro', {})]),
      ]),
      createForm(model, locale, h),
      listView(model, locale, h),
    ],
  ),
)
