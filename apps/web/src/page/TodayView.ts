import { format, type Locale } from '@styld/i18n'
import { type BoardItem, type BoardSummary, flatLay, type Piece, type Slot } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction, smallAction } from '../Actions.styles.ts'
import { addIcon, checkIcon, exploreTabIcon, loader, spinIcon } from '../Icon.ts'
import { addPiecesRouter, boardRouter, exploreRouter, photoRouter, reviewRouter } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { intlLocale } from '../Locale.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { stillTable } from './Board/Table.ts'
import { Message, type Model, showsWornOutfit, TableMotion, tableOutfit, Worn } from './Today.ts'
import type { PiecesData } from '../ServerData.ts'
import { barEnd, round } from './PageBar.styles.ts'
import { pageHead } from './PageHead.ts'
import { title as headTitle } from './PageHead.styles.ts'
import * as styles from './TodayView.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'
import { feedView } from './FeedView.ts'

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
    stillTable(flatLay(outfit), 'paper', [h.Role('img'), h.AriaLabel(format(locale, 'today.outfit', { names }))], h),
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
      isDisabled: saving,
    },
    h,
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

const noteView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const failed = Worn.guards.Failed(model.worn)
  const text = failed
    ? format(locale, 'today.wearFailed', {})
    : showsWornOutfit(model)
      ? format(locale, 'today.wornNote', {})
      : ''
  return h.p(
    [h.Role('status'), ...(failed ? [h.DataAttribute('tone', 'error')] : []), ...styled(h, styles.note())],
    [text],
  )
}

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
    // Explore left the tab bar (owner, 2026-10-31): its way in is the head's round, where other tabs keep their action.
    Option.some(
      h.a(
        [
          h.Href(exploreRouter({})),
          h.AriaLabel(format(locale, 'explore.title', {})),
          h.Title(format(locale, 'explore.title', {})),
          // Its icon lines up with the gutter, where the avatar above and the table below end.
          ...styled(h, cx(round(), barEnd())),
        ],
        [exploreTabIcon(h)],
      ),
    ),
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
      noteView(model, locale, h),
      loaded.some((piece) => piece.status === 'ready') ? missingView(model, locale, h) : h.empty,
    ],
  )
}

/** A window's top on the 1250-unit table: from its top to half way, where the 625-unit window ends at the foot. */
const clamp = (top: number) => Math.min(Math.max(top, 0), 625)

/** How far down a board's 4:5 table its 16:10 window on Home starts, as a share of the table's height (0 to a half),
 * so the window centres on what lies there. A table is 1250 units tall and the window 625.
 * @internal Exported for its tests. */
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
const pickUpCard = (
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

const boardCard = (board: BoardSummary, locale: Locale, h: HtmlBuilder<Message>): Html =>
  pickUpCard(
    'pick-up-board',
    board.name,
    { href: boardRouter({ boardId: board.id }), label: format(locale, 'today.keepGoing', {}) },
    h.div(
      [h.Style({ '--crop': String(cropFrom(board.items)) }), ...styled(h, styles.boardCrop())],
      [stillTable(inView(board.items), board.paper, [], h)],
    ),
    h,
  )

/** The first found pieces waiting in the tray, side by side on paper in the board card's 16:10 window. */
const trayPictures = (pictures: ReadonlyArray<string>, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.AriaHidden(true), ...styled(h, styles.trayThumbs())],
    pictures.map((source) => h.img([h.Src(source), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.trayThumb())])),
  )

/** Where they left off, drawn once the table and its own answers are in, so it arrives in one piece below them. */
const pickUpView = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if ([pieces, model.lastBoard, model.favourite, model.tray].some(isPending)) return h.empty
  const tray = Option.getOrElse(AsyncData.getData(model.tray), () => ({ waiting: 0, pictures: [] }))
  const cards = [
    ...Option.match(Option.flatten(AsyncData.getData(model.favourite)), {
      onNone: () => [],
      onSome: (photo) => [
        pickUpCard(
          'pick-up-photo',
          format(locale, 'today.lovedOutfit', {}),
          { href: photoRouter({ photoId: photo.id }), label: format(locale, 'photo.wearAgain', {}) },
          h.img([
            h.Src(`/cdn/photos/${photo.id}/thumb`),
            h.Alt(''),
            h.Loading('lazy'),
            ...styled(h, styles.photoCrop()),
          ]),
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
    ...Option.match(Option.flatten(AsyncData.getData(model.lastBoard)), {
      onNone: () => [],
      onSome: (board) => [boardCard(board, locale, h)],
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

export const view = Submodel.defineView<Model, Message, { readonly locale: Locale; readonly pieces: PiecesData }>(
  (model, { locale, pieces }, h) =>
    h.main(
      [h.Id('main'), ...styled(h, styles.page())],
      [todayView(model, pieces, locale, h), pickUpView(model, pieces, locale, h), feedView(model.feed, locale, h)],
    ),
)
