import { format, type Locale } from '@styld/i18n'
import type { Board, Piece } from '@styld/protocol'
import { Array, Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { checkIcon, loader, spinIcon } from '../Icon.ts'
import { addPiecesRouter, boardRouter, reviewRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { stillTable } from './Board/Table.ts'
import { asItems } from './Outfit.ts'
import { Message, type Model, Pieces, tableOutfit, Worn } from './Today.ts'
import * as styles from './TodayView.styles.ts'
import { categoryName } from './WardrobeWords.ts'

const intlLocale = (locale: Locale) => (locale === 'sl' ? 'sl' : 'en')

const dateOf = (day: string) => {
  const [year = 2026, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

/** `THU 30`: the weekday and the date, written the way the logo speaks.
 * @internal Exported for its tests. */
export const headline = (day: string, locale: Locale) => {
  const date = dateOf(day)
  const weekday = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' })
    .format(date)
    .replace('.', '')
  return `${weekday.toLocaleUpperCase(intlLocale(locale))} ${String(date.getUTCDate())}`
}

const longDate = (day: string, locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dateOf(day))

const pieceLabel = (piece: Piece, locale: Locale) => piece.name ?? format(locale, categoryName(piece.category), {})

/** The table: the outfit's pieces in their slots. Spin brings in new ones, which drop onto the paper. */
const tableView = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const outfit = tableOutfit(model)
  if (Array.isReadonlyArrayEmpty(pieces.filter((piece) => piece.status === 'ready')))
    return h.div(styled(h, styles.placeholder()), [
      h.div(styled(h, styles.placeholderBody()), [
        h.p([], [format(locale, 'today.empty', {})]),
        h.a([h.Href(addPiecesRouter({})), ...styled(h, primaryAction())], [format(locale, 'today.addClothes', {})]),
      ]),
    ])
  const names = outfit.map(({ piece }) => pieceLabel(piece, locale)).join(', ')
  return h.div(styled(h, styles.table()), [
    stillTable(asItems(outfit), 'paper', [h.Role('img'), h.AriaLabel(format(locale, 'today.outfit', { names }))], h),
  ])
}

const wearButton = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isWorn = Worn.guards.Worn(model.worn) && model.spin === 0
  const saving = Worn.guards.Saving(model.worn)
  return actionButton(
    {
      label: format(locale, isWorn ? 'today.worn' : saving ? 'today.wearing' : 'today.wear', {}),
      leading: isWorn ? checkIcon(h) : saving ? loader(h) : h.empty,
      style: isWorn ? cx(primaryAction(), styles.worn()) : cx(primaryAction(), styles.wear()),
      onClick: Message.ClickedWear(),
      isDisabled: saving,
    },
    h,
  )
}

const noteView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const failed = Worn.guards.Failed(model.worn)
  const text = failed
    ? format(locale, 'today.wearFailed', {})
    : Worn.guards.Worn(model.worn) && model.spin === 0
      ? format(locale, 'today.wornNote', {})
      : ''
  return h.p(
    [h.Role('status'), ...(failed ? [h.DataAttribute('tone', 'error')] : []), ...styled(h, styles.note())],
    [text],
  )
}

const todayView = (model: Model, day: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('today-headline'), ...styled(h, styles.today())],
    [
      h.h1(
        [h.Id('today-headline'), h.AriaLabel(longDate(day, locale)), ...styled(h, styles.headline())],
        [headline(day, locale)],
      ),
      Pieces.match(model.pieces, {
        Loading: () =>
          h.div(
            [h.Role('status'), ...styled(h, styles.placeholder())],
            [loader(h), format(locale, 'today.loading', {})],
          ),
        Failed: () =>
          h.div(styled(h, styles.placeholder()), [
            h.div(styled(h, styles.placeholderBody()), [
              h.p([h.Role('alert')], [format(locale, 'today.failed', {})]),
              actionButton(
                { label: format(locale, 'today.retry', {}), style: secondaryAction(), onClick: Message.ClickedRetry() },
                h,
              ),
            ]),
          ]),
        Loaded: ({ pieces }) => tableView(model, pieces, locale, h),
      }),
      Pieces.guards.Loaded(model.pieces) && model.pieces.pieces.length > 0
        ? h.div(styled(h, styles.actions()), [
            wearButton(model, locale, h),
            h.button(
              [
                h.Type('button'),
                h.AriaLabel(format(locale, 'today.spin', {})),
                h.Title(format(locale, 'today.spin', {})),
                ...styled(h, styles.spin()),
                h.OnClick(Message.ClickedSpin()),
              ],
              [spinIcon(h)],
            ),
          ])
        : h.empty,
      noteView(model, locale, h),
    ],
  )

const boardCard = (board: Board, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(boardRouter({ boardId: board.id })), ...styled(h, styles.card())],
    [
      stillTable(board.items, board.paper, [], h),
      h.span(styled(h, styles.cardTitle()), [board.name]),
      h.span(styled(h, styles.cardAction()), [format(locale, 'today.keepGoing', {})]),
    ],
  )

const pickUpView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const cards = [
    ...(model.waiting > 0
      ? [
          h.a(
            [h.Href(reviewRouter({})), ...styled(h, styles.card())],
            [
              h.span(styled(h, styles.cardTitle()), [format(locale, 'today.waiting', { count: model.waiting })]),
              h.span(styled(h, styles.cardAction()), [format(locale, 'today.review', {})]),
            ],
          ),
        ]
      : []),
    ...Option.match(model.maybeBoard, { onNone: () => [], onSome: (board) => [boardCard(board, locale, h)] }),
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

export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.page())],
    [
      Option.match(model.maybeDay, {
        onNone: () => h.div([h.Role('status'), ...styled(h, styles.placeholder())], [loader(h)]),
        onSome: (day) => todayView(model, day, locale, h),
      }),
      pickUpView(model, locale, h),
    ],
  ),
)
