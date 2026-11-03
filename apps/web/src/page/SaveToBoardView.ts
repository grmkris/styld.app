import { textLength } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import type { BoardSummary } from '@styld/protocol'
import { Array } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { textField } from '../Fields.styles.ts'
import { addIcon, loader, boardsTabIcon } from '../Icon.ts'
import { round } from './PageBar.styles.ts'
import { boardRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { bottomSheet, sheetShown } from './Sheet.ts'
import { Message, type Model, Saving } from './SaveToBoard.ts'
import * as styles from './SaveToBoardView.styles.ts'
import type { BoardsData } from '../ServerData.ts'

const boardRow = (board: BoardSummary, isSending: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    board.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaDisabled(isSending),
          ...styled(h, styles.board()),
          h.OnClick(Message.ClickedBoard({ boardId: board.id, boardName: board.name })),
        ],
        [
          h.span([], [board.name]),
          h.span(styled(h, styles.count()), [format(locale, 'saveToBoard.pins', { count: board.pinCount })]),
        ],
      ),
    ],
  )

const statusView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Saving.match(model.saving, {
    Idle: () => h.empty,
    Sending: () =>
      h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(locale, 'saveToBoard.saving', {})]),
    Saved: ({ boardId, boardName }) =>
      h.p(
        [h.Role('status'), ...styled(h, styles.note())],
        [
          format(locale, 'saveToBoard.saved', { board: boardName }),
          ' ',
          h.a([h.Href(boardRouter({ boardId }))], [format(locale, 'saveToBoard.open', {})]),
        ],
      ),
    Failed: () => h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'saveToBoard.failed', {})]),
  })

const boardsView = (model: Model, boards: BoardsData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isSending = Saving.guards.Sending(model.saving)
  return AsyncData.matchData(boards, {
    onEmpty: () => h.p([h.Role('status')], [loader(h)]),
    onFailure: () =>
      h.div(
        [],
        [
          h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'saveToBoard.loadFailed', {})]),
          actionButton(
            {
              label: format(locale, 'saveToBoard.retry', {}),
              style: secondaryAction(),
              onClick: Message.ClickedRetry(),
            },
            h,
          ),
        ],
      ),
    onData: (list) =>
      Array.match(list, {
        onEmpty: () => h.p(styled(h, styles.note()), [format(locale, 'saveToBoard.noBoards', {})]),
        onNonEmpty: (some) =>
          h.ul(
            styled(h, styles.list()),
            Array.map(some, (board) => boardRow(board, isSending, locale, h)),
          ),
      }),
  })
}

const newBoardView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isSending = Saving.guards.Sending(model.saving)
  return h.form(
    [h.OnSubmit(Message.SubmittedNewBoard()), h.Attribute('novalidate', ''), ...styled(h, styles.create())],
    [
      h.label(
        [h.For(`${model.sheet.id}-name`), ...styled(h, styles.field())],
        [
          format(locale, 'saveToBoard.newBoard', {}),
          h.input([
            h.Id(`${model.sheet.id}-name`),
            ...styled(h, textField()),
            h.Placeholder(format(locale, 'saveToBoard.newBoardPlaceholder', {})),
            h.Value(model.name),
            h.Maxlength(textLength.boardName),
            h.Readonly(isSending),
            h.OnInput((value) => Message.UpdatedName({ value })),
          ]),
        ],
      ),
      actionButton(
        {
          label: format(locale, 'saveToBoard.save', {}),
          style: primaryAction(),
          type: 'submit',
          isDisabled: isSending || model.name.trim().length === 0,
          leading: addIcon(h),
        },
        h,
      ),
    ],
  )
}

const sheetView = (model: Model, boards: BoardsData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  bottomSheet(
    {
      dialog: model.sheet,
      title: format(locale, 'saveToBoard.title', {}),
      body: () => [
        h.div(styled(h, styles.body()), [
          statusView(model, locale, h),
          h.h3(styled(h, styles.section()), [format(locale, 'saveToBoard.boardsLabel', {})]),
          boardsView(model, boards, locale, h),
          newBoardView(model, locale, h),
        ]),
      ],
      toParentMessage: (message) => Message.GotSheetMessage({ message }),
      locale,
    },
    h,
  )

/** What a page showing "Save to board" hands it: the language, and the person's boards as the app last read them. */
export type ViewInputs = { readonly locale: Locale; readonly boards: BoardsData }

/** The "Save to board" button, and its sheet while open. */
export const view = Submodel.defineView<Model, Message, ViewInputs>((model, { locale, boards }, h) =>
  h.div(
    [],
    [
      actionButton(
        { label: format(locale, 'saveToBoard.action', {}), style: secondaryAction(), onClick: Message.ClickedSave() },
        h,
      ),
      sheetShown(model.sheet) ? sheetView(model, boards, locale, h) : h.empty,
    ],
  ),
)

/** A compact board action beside a piece's name, with the same board picker. */
export const compactView = Submodel.defineView<Model, Message, ViewInputs>((model, { locale, boards }, h) =>
  h.div(
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'saveToBoard.add', {})),
          h.Title(format(locale, 'saveToBoard.add', {})),
          h.OnClick(Message.ClickedSave()),
          ...styled(h, round()),
        ],
        [boardsTabIcon(h)],
      ),
      sheetShown(model.sheet) ? sheetView(model, boards, locale, h) : h.empty,
    ],
  ),
)
