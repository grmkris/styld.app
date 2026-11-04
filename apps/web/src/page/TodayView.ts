import { piecesById } from '../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import { flatLay, type Piece, type Slot } from '@styld/protocol'
import { Array, Option } from 'effect'
import { Button } from '@foldkit/ui'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { chip } from '../Controls.styles.ts'
import { addIcon, checkIcon, loader, retryIcon, spinIcon } from '../Icon.ts'
import { addPiecesRouter } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { intlLocale } from '../Locale.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { fromStyld, stillTable } from './Board/Table.ts'
import { canSwap, Message, type Model, showsWornOutfit, Swap, TableMotion, tableOutfit, Worn } from './Today.ts'
import type { PiecesData } from '../ServerData.ts'
import { pageHead } from './PageHead.ts'
import { title as headTitle } from './PageHead.styles.ts'
import * as styles from './TodayView.styles.ts'
import { pieceDescription, pieceLabel } from './WardrobeWords.ts'
import { feedView } from './FeedView.ts'
import { type HomeData, pickUpView } from './PickUpView.ts'

const dateOf = (day: string) => {
  const [year = 2026, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

/** `THU 30`: the weekday and the date, written the way the logo speaks.
 */
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

const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div([h.Role('status'), ...styled(h, styles.placeholder())], [loader(h), format(locale, 'today.loading', {})])

const retryView = (problem: string, retry: Message, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.placeholder()), [
    h.div(styled(h, styles.placeholderBody()), [
      h.p([h.Role('alert')], [problem]),
      actionButton({ label: format(locale, 'today.retry', {}), style: secondaryAction(), onClick: retry }, h),
    ]),
  ])

/** The table: the outfit's pieces laid flat. Spin brings in new ones, which drop onto the paper; until the first
 * outfits come, it waits, unless it shows what was worn today. */
const tableView = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (Array.isReadonlyArrayEmpty(pieces.filter((piece) => piece.status === 'ready')))
    return h.div(styled(h, styles.placeholder()), [
      h.div(styled(h, styles.placeholderBody()), [
        h.p([], [format(locale, 'today.empty', {})]),
        h.a([h.Href(addPiecesRouter({})), ...styled(h, primaryAction())], [format(locale, 'today.addClothes', {})]),
      ]),
    ])
  if (!showsWornOutfit(model) && isPending(model.outfits)) return loadingView(locale, h)
  if (!showsWornOutfit(model) && AsyncData.isFailure(model.outfits))
    return retryView(format(locale, 'today.outfitFailed', {}), Message.ClickedRetryOutfits(), locale, h)
  const outfit = tableOutfit(model, pieces)
  const names = outfit.map((piece) => pieceLabel(piece, locale)).join(', ')
  return h.div(TableMotion.guards.Spun(model.motion) ? styled(h, styles.table()) : [], [
    stillTable(
      flatLay(outfit),
      'paper',
      [h.Role('img'), h.AriaLabel(format(locale, 'today.outfit', { names }))],
      h,
      fromStyld(piecesById(outfit)),
    ),
  ])
}

const wearButton = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isWorn = showsWornOutfit(model)
  const saving = Worn.guards.Saving(model.worn)
  return actionButton(
    {
      label: format(locale, isWorn ? 'today.worn' : saving ? 'today.wearing' : 'today.wear', {}),
      leading: isWorn ? checkIcon(h) : saving ? loader(h) : h.empty,
      style: isWorn ? cx(primaryAction(), styles.worn()) : cx(primaryAction(), styles.wear()),
      onClick: Message.ClickedWear({ pieceIds: tableOutfit(model, pieces).map((piece) => piece.id) }),
      isDisabled: saving || Swap.guards.Swapping(model.swap),
    },
    h,
  )
}

/** Swap one piece of the outfit on the table, keeping the others: a chip for each, named for the piece. While a swap
 * or Wear this is on its way every chip waits, the piece being swapped turning. */
const swapView = (outfit: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (!canSwap(model, outfit)) return h.empty
  const pieceIds = outfit.map((piece) => piece.id)
  const waiting = Swap.guards.Swapping(model.swap) || Worn.guards.Saving(model.worn)
  return h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'today.swapPieces', {})), ...styled(h, styles.swaps())],
    outfit.map((piece) => {
      const name = pieceLabel(piece, locale)
      const turning = Swap.guards.Swapping(model.swap) && model.swap.pieceId === piece.id
      return h.keyed('span')(piece.id, styled(h, styles.swapItem()), [
        Button.view(
          {
            onClick: Message.ClickedSwapPiece({ pieceId: piece.id, pieceIds }),
            isDisabled: waiting,
            toView: (attributes) =>
              h.button(
                [
                  ...attributes.button,
                  h.AriaLabel(format(locale, 'today.swap', { name: pieceDescription(piece, locale) })),
                  ...styled(h, cx(chip(), styles.swapChip())),
                ],
                [turning ? loader(h) : retryIcon(h), h.span(styled(h, styles.swapName()), [name])],
              ),
          },
          h,
        ),
      ])
    }),
  )
}

const missingLabel: Partial<Record<Slot, 'today.addTop' | 'today.addBottom' | 'today.addShoes'>> = {
  top: 'today.addTop',
  bottom: 'today.addBottom',
  shoes: 'today.addShoes',
}

/** The places a whole outfit lacks, as the engine said: tops, bottoms and shoes. */
const missingOf = (model: Model) =>
  Option.match(AsyncData.getData(model.outfits), {
    onNone: () => [],
    onSome: ({ missing }) => missing.flatMap((slot) => Option.toArray(Option.fromNullishOr(missingLabel[slot]))),
  })

/** A wardrobe short of a whole outfit says what to add, each a way into adding pieces. */
const missingView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Array.match(missingOf(model), {
    onEmpty: () => h.empty,
    onNonEmpty: (missing) =>
      h.div(
        styled(h, styles.missing()),
        missing.map((key) =>
          h.a([h.Href(addPiecesRouter({})), ...styled(h, styles.missingLink())], [addIcon(h), format(locale, key, {})]),
        ),
      ),
  })

/** What a swap that did not change the table says: nothing else fits in place of the piece, or the swap failed. */
const swapNote = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale) => {
  const nameOf = (pieceId: string) =>
    Option.match(
      Array.findFirst(pieces, (piece) => piece.id === pieceId),
      { onNone: () => '', onSome: (piece) => pieceLabel(piece, locale) },
    )
  return Swap.match(model.swap, {
    Idle: () => '',
    Swapping: () => '',
    NoOther: ({ pieceId }) => format(locale, 'today.swapNone', { name: nameOf(pieceId) }),
    Failed: () => format(locale, 'today.swapFailed', {}),
  })
}

/** The table's one polite status line: today's log not read, Wear this failed, the outfit logged, or how a swap went. */
const noteView = (model: Model, pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (Worn.guards.Unread(model.worn)) return unreadView(locale, h)
  const failed = Worn.guards.Failed(model.worn) || Swap.guards.Failed(model.swap)
  const text = Worn.guards.Failed(model.worn)
    ? format(locale, 'today.wearFailed', {})
    : showsWornOutfit(model)
      ? format(locale, 'today.wornNote', {})
      : swapNote(model, pieces, locale)
  return h.p(
    [h.Role('status'), ...(failed ? [h.DataAttribute('tone', 'error')] : []), ...styled(h, styles.note())],
    [text],
  )
}

/** Today's log did not load: said where the note stands, with Try again; Wear this still logs the outfit. */
const unreadView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Role('status'), h.DataAttribute('tone', 'error'), ...styled(h, styles.note())],
    [
      format(locale, 'today.wornUnread', {}),
      ' ',
      actionButton(
        { label: format(locale, 'today.retry', {}), style: linkAction(), onClick: Message.ClickedRetryWorn() },
        h,
      ),
    ],
  )

/** The day in the logo's voice. Before the browser knows it, the line keeps its height and says "Today". */
const headlineView = (maybeDay: Option.Option<string>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  pageHead(
    h.h1(
      [
        h.Id('today-headline'),
        ...Option.match(maybeDay, { onNone: () => [], onSome: (day) => [h.AriaLabel(longDate(day, locale))] }),
        ...styled(h, cx(headTitle(), styles.headline())),
      ],
      Option.match(maybeDay, {
        onNone: () => [h.span(styled(h, visuallyHidden()), [format(locale, 'today.title', {})])],
        onSome: (day) => [headline(day, locale)],
      }),
    ),
    Option.none(),
    h,
  )

const tableArea = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  AsyncData.matchData(pieces, {
    onEmpty: () => loadingView(locale, h),
    onFailure: () => retryView(format(locale, 'today.failed', {}), Message.ClickedRetry(), locale, h),
    onData: (list) => tableView(model, list, locale, h),
  })

/** Nothing is asked for yet, or the first answer is on its way. */
const isPending = (data: AsyncData.AsyncData<unknown, unknown>) => AsyncData.isIdle(data) || AsyncData.isLoading(data)

/** Spin, once today's outfits are in: its shape while they come (a worn day shows its outfit before), and nothing
 * when they failed. */
const spinView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (isPending(model.outfits)) return h.span([h.AriaHidden(true), ...styled(h, cx(block(), styles.spinSkeleton()))])
  if (!AsyncData.isSuccess(model.outfits)) return h.empty
  return h.button(
    [
      h.Type('button'),
      h.AriaLabel(format(locale, 'today.spin', {})),
      h.Title(format(locale, 'today.spin', {})),
      ...styled(h, styles.spin()),
      h.OnClick(Message.ClickedSpin()),
    ],
    [spinIcon(h)],
  )
}

/** Wear this and Spin, beside an outfit on the table only. While one is coming their shapes wait; when none can come
 * (nothing ready, or the outfits failed), the table's own action is the screen's one. */
const actionsView = (
  model: Model,
  pieces: PiecesData,
  loaded: ReadonlyArray<Piece>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  if (Array.isReadonlyArrayNonEmpty(tableOutfit(model, loaded)))
    return h.div(styled(h, styles.actions()), [wearButton(model, loaded, locale, h), spinView(model, locale, h)])
  const coming = isPending(pieces) || (loaded.some((piece) => piece.status === 'ready') && isPending(model.outfits))
  if (!coming) return h.empty
  return h.div(
    [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.actions())],
    [h.span(styled(h, cx(block(), styles.wearSkeleton()))), h.span(styled(h, cx(block(), styles.spinSkeleton())))],
  )
}

const todayView = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const loaded = Option.getOrElse(AsyncData.getData(pieces), (): ReadonlyArray<Piece> => [])
  return h.section(
    [h.AriaLabelledBy('today-headline'), ...styled(h, styles.today())],
    [
      headlineView(model.maybeDay, locale, h),
      tableArea(model, pieces, locale, h),
      actionsView(model, pieces, loaded, locale, h),
      swapView(tableOutfit(model, loaded), model, locale, h),
      noteView(model, loaded, locale, h),
      loaded.some((piece) => piece.status === 'ready') ? missingView(model, locale, h) : h.empty,
    ],
  )
}

export const view = Submodel.defineView<Model, Message, HomeData & { readonly locale: Locale }>(
  (model, { locale, pieces, boards }, h) =>
    h.main(
      [h.Id('main'), ...styled(h, styles.page())],
      [
        todayView(model, pieces, locale, h),
        pickUpView(model.pickUp, { pieces, boards }, locale, h),
        feedView(model.feed, locale, h),
      ],
    ),
)
