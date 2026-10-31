import { Button } from '@foldkit/ui'
import { GarmentGroup, groupOf, Occasion, type Piece, type PieceType, Season, typesIn } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { filtersIcon, loader } from '../Icon.ts'
import { addPiecesRouter, pieceRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { brandsOf, filterCount, Message, type Model, shownPieces } from './Wardrobe.ts'
import { groupName, occasionName, pieceLabel, seasonName, typeName } from './WardrobeWords.ts'
import { chipPicker, colourPicker } from './PieceFields.ts'
import { bottomSheet, sheetShown } from './Sheet.ts'
import * as styles from './WardrobeView.styles.ts'
import { wardrobeMain } from './WardrobeTabs.ts'
import { chip, chipSkeleton, sheetBody } from './AskView.styles.ts'
import { chosen } from './ExploreView.styles.ts'

/** The small image of a piece; the API Worker serves it to its owner only. A new drawing is a new address. */
const thumbnailPath = (piece: Piece) =>
  `/cdn/pieces/${piece.id}/thumb${piece.picture === undefined ? '' : `?v=${piece.picture.shows}${piece.picture.version}`}`

/** The kept cut-outs with no clean picture yet, and a free way to ask for theirs. */
const backfillLine = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (model.backfill === 'sent')
    return h.p(
      [h.Role('status'), ...styled(h, styles.backfill())],
      [format(locale, 'wardrobe.picture.backfillSent', {})],
    )
  if (model.undrawn === 0) return h.empty
  return h.div(styled(h, styles.backfill()), [
    h.span([], [format(locale, 'wardrobe.picture.backfill', { count: model.undrawn })]),
    actionButton(
      {
        label: format(locale, 'wardrobe.picture.backfillAction', {}),
        style: linkAction(),
        onClick: Message.ClickedDrawPictures(),
        isDisabled: model.backfill === 'sending',
        leading: model.backfill === 'sending' ? loader(h) : h.empty,
      },
      h,
    ),
    model.backfill === 'failed'
      ? h.p([h.Role('alert')], [format(locale, 'wardrobe.picture.backfillFailed', {})])
      : h.empty,
  ])
}

/** One chip of a filter row: its name, how many pieces it holds, and whether it is the one shown. */
const filter = (label: string, total: number, pressed: boolean, onClick: Message, h: HtmlBuilder<Message>): Html =>
  Button.view(
    {
      onClick,
      toView: (attributes) =>
        h.button(
          [
            ...attributes.button,
            h.AriaPressed(String(pressed)),
            ...styled(h, cx(chip(), chosen(), styles.filterChip())),
          ],
          [label, ' ', h.span(styled(h, styles.count()), [String(total)])],
        ),
    },
    h,
  )

const filterRow = (
  label: string,
  chips: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
  look: Parameters<typeof styled>[1] = styles.filterRow(),
): Html => h.div([h.Role('group'), h.AriaLabel(label), ...styled(h, look)], [...chips])

/** Opens the filter sheet, a control rather than a category: it opens a dialog and toggles nothing. Once filters are
 * set it is filled in and says how many. */
const filtersButton = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const count = filterCount(model.filters)
  return Button.view(
    {
      onClick: Message.ClickedFilters(),
      toView: (attributes) =>
        h.button(
          [
            ...attributes.button,
            h.AriaHasPopup('dialog'),
            h.AriaExpanded(model.filterSheet.isOpen),
            ...(count > 0 ? [h.DataAttribute('set', '')] : []),
            ...styled(h, cx(chip(), styles.filterChip(), styles.filtersSet())),
          ],
          [
            filtersIcon(h),
            format(locale, 'wardrobe.filters', {}),
            ...(count === 0 ? [] : [' ', h.span(styled(h, styles.count()), [String(count)])]),
          ],
        ),
    },
    h,
  )
}

/** The groups the person has pieces in, with All first; they scroll beside Filters and are cut at the screen's edge. */
const groupRow = (pieces: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  filterRow(
    format(locale, 'wardrobe.filterCategories', {}),
    [
      filter(
        format(locale, 'wardrobe.allItems', {}),
        pieces.length,
        Option.isNone(model.group),
        Message.ClickedGroup({ group: Option.none() }),
        h,
      ),
      ...GarmentGroup.literals.flatMap((group) => {
        const total = pieces.filter((piece) => groupOf(piece.type) === group).length
        return total === 0
          ? []
          : [
              filter(
                format(locale, groupName(group), {}),
                total,
                Option.contains(model.group, group),
                Message.ClickedGroup({ group: Option.some(group) }),
                h,
              ),
            ]
      }),
    ],
    h,
    cx(styles.filterRow(), styles.groupScroll()),
  )

/** The chosen group's types the person has, with All of the group first. */
const typeRow = (inGroup: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(model.group, {
    onNone: () => h.empty,
    onSome: (group) =>
      filterRow(
        format(locale, groupName(group), {}),
        [
          filter(
            format(locale, 'wardrobe.allItems', {}),
            inGroup.length,
            Option.isNone(model.type),
            Message.ClickedType({ type: Option.none() }),
            h,
          ),
          ...typesIn(group).flatMap((type: PieceType) => {
            const total = inGroup.filter((piece) => piece.type === type).length
            return total === 0
              ? []
              : [
                  filter(
                    format(locale, typeName(type), {}),
                    total,
                    Option.contains(model.type, type),
                    Message.ClickedType({ type: Option.some(type) }),
                    h,
                  ),
                ]
          }),
        ],
        h,
      ),
  })

const pieceState = (piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (piece.status === 'processing')
    return h.span(styled(h, styles.pieceState()), [loader(h), format(locale, 'wardrobe.statusProcessing', {})])
  if (piece.status === 'failed')
    return h.span(styled(h, styles.pieceFailed()), [format(locale, 'wardrobe.itemProcessFailed', {})])
  return h.empty
}

const pieceTile = (piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const label = pieceLabel(piece, locale)
  return h.keyed('li')(
    piece.id,
    [],
    [
      h.a(
        [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.cut())],
        [
          // The caption names the piece; the picture would only say it twice.
          h.img([h.Src(thumbnailPath(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.cutImage())]),
          h.span(styled(h, styles.caption()), [label]),
          pieceState(piece, locale, h),
        ],
      ),
    ],
  )
}

/** The filter sheet's pickers: colours, when and what for, and the brands the person wrote down. */
const filterPickers = (
  pieces: ReadonlyArray<Piece>,
  model: Model,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const brands = brandsOf(pieces)
  return [
    colourPicker(
      {
        id: 'filter-colours',
        legend: 'wardrobe.colorsLabel',
        problem: Option.none(),
        chosen: model.filters.colours,
        onToggle: (colour) => Message.ToggledFilterColour({ colour }),
      },
      locale,
      h,
    ),
    chipPicker(
      {
        id: 'filter-season',
        legend: 'wardrobe.filterSeason',
        problem: Option.none(),
        values: Season.literals,
        label: (season) => format(locale, seasonName(season), {}),
        isChosen: (season) => Option.contains(model.filters.season, season),
        onChoose: (season) => Message.ChoseFilterSeason({ season }),
      },
      locale,
      h,
    ),
    chipPicker(
      {
        id: 'filter-occasion',
        legend: 'wardrobe.filterOccasion',
        problem: Option.none(),
        values: Occasion.literals,
        label: (occasion) => format(locale, occasionName(occasion), {}),
        isChosen: (occasion) => Option.contains(model.filters.occasion, occasion),
        onChoose: (occasion) => Message.ChoseFilterOccasion({ occasion }),
      },
      locale,
      h,
    ),
    brands.length === 0
      ? h.empty
      : chipPicker(
          {
            id: 'filter-brand',
            legend: 'wardrobe.filterBrand',
            problem: Option.none(),
            values: brands,
            label: (brand) => brand,
            isChosen: (brand) => Option.contains(model.filters.brand, brand),
            onChoose: (brand) => Message.ChoseFilterBrand({ brand }),
          },
          locale,
          h,
        ),
  ]
}

/** The filter sheet: colours, when and what for, and the brands the person wrote down; Show closes it on what is
 * left. */
const filterSheet = (pieces: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const left = shownPieces(pieces, model).length
  return bottomSheet(
    {
      dialog: model.filterSheet,
      title: format(locale, 'wardrobe.filtersTitle', {}),
      locale,
      toParentMessage: (message) => Message.GotFilterSheetMessage({ message }),
      body: () => [
        h.div(styled(h, sheetBody()), [
          ...filterPickers(pieces, model, locale, h),
          h.div(styled(h, styles.sheetActions()), [
            actionButton(
              {
                label: format(locale, 'wardrobe.clearFilters', {}),
                style: secondaryAction(),
                onClick: Message.ClickedClearFilters(),
                isDisabled: filterCount(model.filters) === 0,
              },
              h,
            ),
            actionButton(
              {
                label: format(locale, 'wardrobe.showPieces', { count: left }),
                style: primaryAction(),
                onClick: Message.ClickedShowPieces(),
              },
              h,
            ),
          ]),
        ]),
      ],
    },
    h,
  )
}

const loadedView = (pieces: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (pieces.length === 0)
    return h.section(styled(h, styles.message()), [
      h.h2(styled(h, styles.messageTitle()), [format(locale, 'wardrobe.closetEmptyTitle', {})]),
      h.p([], [format(locale, 'wardrobe.emptyHint', {})]),
      // The head's + is the page's one ink action; this one says the same quietly, as Looks' does.
      h.a(
        [h.Href(addPiecesRouter({})), ...styled(h, secondaryAction())],
        [format(locale, 'wardrobe.scanPhotosCta', {})],
      ),
    ])
  const inGroup = Option.match(model.group, {
    onNone: () => pieces,
    onSome: (group) => pieces.filter((piece) => groupOf(piece.type) === group),
  })
  const shown = shownPieces(pieces, model)
  return h.div(styled(h, styles.wardrobePage()), [
    backfillLine(model, locale, h),
    h.div(styled(h, styles.browseRow()), [filtersButton(model, locale, h), groupRow(pieces, model, locale, h)]),
    typeRow(inGroup, model, locale, h),
    shown.length === 0
      ? h.p(styled(h, styles.message()), [format(locale, 'wardrobe.noneFiltered', {})])
      : h.ul(
          styled(h, styles.grid()),
          shown.map((piece) => pieceTile(piece, locale, h)),
        ),
    sheetShown(model.filterSheet) ? filterSheet(pieces, model, locale, h) : h.empty,
  ])
}

const skeletonTiles = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/** The shape of what is coming: the group row and six captioned squares, where the pieces will be. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.wardrobePage()), [
    h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'wardrobe.shelves.loadingPieces', {})]),
    h.div(
      [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.filterRowSkeleton())],
      [
        h.span(styled(h, cx(block(), chipSkeleton()))),
        h.span(styled(h, cx(block(), chipSkeleton()))),
        h.span(styled(h, cx(block(), chipSkeleton()))),
      ],
    ),
    h.ul(
      [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.grid())],
      skeletonTiles.map((slot) =>
        h.keyed('li')(slot, styled(h, styles.cut()), [
          h.span(styled(h, cx(block(), styles.tileSkeleton()))),
          h.span(styled(h, cx(line(), styles.captionSkeleton()))),
        ]),
      ),
    ),
  ])

const failedView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(styled(h, styles.message()), [
    h.p([h.Role('alert')], [format(locale, 'wardrobe.shelves.loadFailed', {})]),
    actionButton(
      { label: format(locale, 'wardrobe.shelves.retry', {}), style: primaryAction(), onClick: Message.ClickedRetry() },
      h,
    ),
  ])

/** The person's pieces on paper, browsed by group and type as a shop is (Gallery `wardrobe.html`). */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  wardrobeMain(
    'pieces',
    styles.wardrobePage(),
    [
      AsyncData.matchData(model.pieces, {
        onEmpty: () => loadingView(locale, h),
        onFailure: () => failedView(locale, h),
        onData: (pieces) => loadedView(pieces, model, locale, h),
      }),
    ],
    locale,
    h,
  ),
)
