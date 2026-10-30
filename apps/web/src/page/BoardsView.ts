import { format, type Locale } from '@styld/i18n'
import type { Board } from '@styld/protocol'
import { Array } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { textField } from '../Fields.styles.ts'
import { addIcon, loader } from '../Icon.ts'
import { boardRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { stillTable } from './Board/Table.ts'
import { BoardList, Creating, Message, type Model } from './Boards.ts'
import * as styles from './BoardsView.styles.ts'

const tileView = (board: Board, locale: Locale, h: HtmlBuilder<Message>): Html =>
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
          h.span(styled(h, styles.tileMeta()), [format(locale, 'boards.items', { count: board.items.length })]),
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

const listView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  BoardList.match(model.boards, {
    Loading: () =>
      h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(locale, 'boards.loading', {})]),
    Failed: () =>
      h.div(styled(h, styles.head()), [
        h.p([h.Role('alert')], [format(locale, 'boards.failed', {})]),
        actionButton(
          { label: format(locale, 'boards.retry', {}), style: cx(secondaryAction()), onClick: Message.ClickedRetry() },
          h,
        ),
      ]),
    Loaded: ({ boards }) =>
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
        h.h1([], [format(locale, 'boards.title', {})]),
        h.p(styled(h, styles.intro()), [format(locale, 'boards.intro', {})]),
      ]),
      createForm(model, locale, h),
      listView(model, locale, h),
    ],
  ),
)
