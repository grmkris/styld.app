import { cdn } from '../Cdn.ts'
import { Button } from '@foldkit/ui'
import { GarmentGroup, groupOf, Occasion, type Piece, type PieceType, textLength, typesIn } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, quietLinkAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { filtersIcon, loader } from '../Icon.ts'
import { addPiecesRouter, browseRouter, pieceRouter } from '../route.ts'
import { type Browse, browseGroup, browseType } from '../WardrobeBrowse.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import type { PiecesData } from '../ServerData.ts'
import { brandsOf, CategoryEdit, filterCount, Message, type Model, newestOf, shownPieces } from './Wardrobe.ts'
import { groupName, occasionName, pieceLabel, seasonName, typeName } from './WardrobeWords.ts'
import { backTo, backToWardrobe } from './PageBar.ts'
import { categoriesOf, chipPicker, colourPicker, WornWhen } from './PieceFields.ts'
import { bottomSheet, sheetShown } from './Sheet.ts'
import * as styles from './WardrobeView.styles.ts'
import * as WardrobeSelect from './WardrobeSelect.ts'
import * as WardrobeSelectView from './WardrobeSelectView.ts'
import { wardrobeMain } from './SectionMain.ts'
import { chip } from '../Controls.styles.ts'
import { sheetBody } from './Sheet.styles.ts'
import { loadingStatus, placeholderList } from '../Loading.ts'

/** The small image of a piece; the API Worker serves it to its owner only. A new drawing is a new address. */
const thumbnailPath = (piece: Piece) => cdn.piece(piece, 'thumb')

/** Opens the filter sheet, a control rather than a category: it opens a dialog and toggles nothing. Once filters are
 * set it is filled in and says how many. */
const filtersButton = (model: Model, browse: Browse, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const count = filterCount(browse.filters)
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

/** A category's card: its name, and the picture of its newest piece (Eva's review, ABOUT YOU's categories; owner,
 * 2026-11-03). The name says what it is; the picture would only say it twice. */
const categoryCard = (name: string, href: string, pieces: ReadonlyArray<Piece>, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    href,
    [],
    [
      h.a(
        [h.Href(href), ...styled(h, styles.category())],
        [
          h.span(styled(h, styles.categoryName()), [name]),
          ...Option.match(newestOf(pieces), {
            onNone: () => [],
            onSome: (piece) => [
              h.img([h.Src(thumbnailPath(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.categoryImage())]),
            ],
          }),
        ],
      ),
    ],
  )

/** A category's card as the grid lists it: its name, where it leads and what it holds. */
interface Card {
  readonly name: string
  readonly href: string
  readonly pieces: ReadonlyArray<Piece>
}

/** The cards of the categories that hold pieces; one that holds none is not shown, so the wardrobe grows with them. */
const categoryCards = (label: string, cards: ReadonlyArray<Card>, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.AriaLabel(label), ...styled(h, styles.categories())],
    cards.flatMap((card) => (card.pieces.length === 0 ? [] : [categoryCard(card.name, card.href, card.pieces, h)])),
  )

/** A level's head below the wardrobe's: the round back a step up, and the category's name. */
const levelHead = (back: Html, title: string, rest: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.levelHead()), [back, h.h2(styled(h, styles.levelTitle()), [title]), ...rest])

const pieceState = (piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (piece.status === 'processing')
    return h.span(styled(h, styles.pieceState()), [loader(h), format(locale, 'wardrobe.statusProcessing', {})])
  if (piece.status === 'failed')
    return h.span(styled(h, styles.pieceFailed()), [format(locale, 'wardrobe.itemProcessFailed', {})])
  return h.empty
}

const pieceTile = (piece: Piece, browse: Browse, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const label = pieceLabel(piece, locale)
  return h.keyed('li')(
    piece.id,
    [h.Id(`piece-${piece.id}`)],
    [
      h.a(
        [
          h.Href(pieceRouter({ pieceId: piece.id, from: `${browseRouter({ browse })}#piece-${piece.id}` })),
          // No label under the cut-out (Eva's review, F-11): the link carries the piece's name for whoever cannot see
          // the picture, and the piece's page says the rest.
          h.AriaLabel(label),
          ...styled(h, styles.cut()),
        ],
        [
          h.img([h.Src(thumbnailPath(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.cutImage())]),
          pieceState(piece, locale, h),
        ],
      ),
    ],
  )
}

/** The filter sheet's pickers: colours, when and what for, and the brands the person wrote down. */
const filterPickers = (
  pieces: ReadonlyArray<Piece>,
  browse: Browse,
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
        chosen: browse.filters.colours,
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
        values: WornWhen.literals,
        label: (when) => format(locale, when === 'rainproof' ? 'wardrobe.rainproof' : seasonName(when), {}),
        isChosen: (when) =>
          when === 'rainproof' ? browse.filters.rainproof : Option.contains(browse.filters.season, when),
        onChoose: (when) =>
          when === 'rainproof' ? Message.ToggledFilterRainproof() : Message.ChoseFilterSeason({ season: when }),
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
        isChosen: (occasion) => Option.contains(browse.filters.occasion, occasion),
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
            isChosen: (brand) => Option.contains(browse.filters.brand, brand),
            onChoose: (brand) => Message.ChoseFilterBrand({ brand }),
          },
          locale,
          h,
        ),
  ]
}

/** The filter sheet: colours, when and what for, and the brands the person wrote down; Show closes it on what is
 * left. */
const filterSheet = (
  pieces: ReadonlyArray<Piece>,
  model: Model,
  browse: Browse,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const left = shownPieces(pieces, browse).length
  return bottomSheet(
    {
      dialog: model.filterSheet,
      title: format(locale, 'wardrobe.filtersTitle', {}),
      locale,
      toParentMessage: (message) => Message.GotFilterSheetMessage({ message }),
      body: () => [
        h.div(styled(h, sheetBody()), [
          ...filterPickers(pieces, browse, locale, h),
          h.div(styled(h, styles.sheetActions()), [
            actionButton(
              {
                label: format(locale, 'wardrobe.clearFilters', {}),
                style: secondaryAction(),
                onClick: Message.ClickedClearFilters(),
                isDisabled: filterCount(browse.filters) === 0,
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

/** What went wrong with the last rename or delete, if it did. */
const categoryProblem = (edit: CategoryEdit, locale: Locale, h: HtmlBuilder<Message>): Html =>
  (CategoryEdit.guards.Renaming(edit) || CategoryEdit.guards.Deleting(edit)) && edit.failed
    ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.categoryEditFailed', {})])
    : h.empty

const cancelCategoryEdit = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  actionButton(
    { label: format(locale, 'common.cancel', {}), style: linkAction(), onClick: Message.ClickedCancelCategoryEdit() },
    h,
  )

/** The category's new name being typed, saved as one operation. */
const renameForm = (
  edit: Extract<CategoryEdit, { readonly _tag: 'Renaming' }>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [h.OnSubmit(Message.SubmittedCategoryName()), ...styled(h, styles.categoryEdit())],
    [
      h.label([h.For('category-name'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.categoryNameLabel', {})]),
      h.input([
        h.Id('category-name'),
        h.Type('text'),
        h.Maxlength(textLength.category),
        h.Value(edit.name),
        h.OnInput((value) => Message.UpdatedCategoryName({ value })),
        ...styled(h, textField()),
      ]),
      categoryProblem(edit, locale, h),
      h.div(styled(h, styles.categoryActions()), [
        h.button(
          [h.Type('submit'), h.Disabled(edit.sending), ...styled(h, primaryAction())],
          [format(locale, 'wardrobe.categorySave', {})],
        ),
        cancelCategoryEdit(locale, h),
      ]),
    ],
  )

/** The delete asked first, saying its pieces stay under their type. */
const deleteQuestion = (
  edit: Extract<CategoryEdit, { readonly _tag: 'Deleting' }>,
  name: string,
  type: PieceType,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [
      h.Role('alertdialog'),
      h.AriaLabel(format(locale, 'wardrobe.categoryDelete', {})),
      ...styled(h, styles.categoryEdit()),
    ],
    [
      h.p([], [format(locale, 'wardrobe.categoryDeleteQuestion', { name, type: format(locale, typeName(type), {}) })]),
      categoryProblem(edit, locale, h),
      h.div(styled(h, styles.categoryActions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.categoryDelete', {}),
            style: primaryAction(),
            onClick: Message.ClickedConfirmDeleteCategory(),
            isDisabled: edit.sending,
          },
          h,
        ),
        cancelCategoryEdit(locale, h),
      ]),
    ],
  )

/** A category of the person's own, renamed or deleted from its page (T-12): its two quiet actions, the new name being
 * typed, or the delete being confirmed. */
const categoryEditView = (model: Model, name: string, type: PieceType, locale: Locale, h: HtmlBuilder<Message>): Html =>
  CategoryEdit.match(model.categoryEdit, {
    Renaming: (edit) => renameForm(edit, locale, h),
    Deleting: (edit) => deleteQuestion(edit, name, type, locale, h),
    Idle: () =>
      h.div(styled(h, styles.categoryActions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.categoryRename', {}),
            style: linkAction(),
            onClick: Message.ClickedRenameCategory(),
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'wardrobe.categoryDelete', {}),
            style: cx(linkAction(), quietLinkAction()),
            onClick: Message.ClickedDeleteCategory(),
          },
          h,
        ),
      ]),
  })

/** Select mode's chip, and its ticks in place of the links while it is on (`WardrobeSelectView.ts`). */
const selectSlot = (
  slotId: string,
  view: typeof WardrobeSelectView.ticks,
  pieces: ReadonlyArray<Piece>,
  model: Model,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    model: model.selection,
    view,
    viewInputs: { pieces, locale },
    toParentMessage: (message) => Message.GotSelectMessage({ message }),
  })

/** The chosen type's pieces, label-free, with the one Filter button that narrows them (Eva's review, F-11), and Select
 * to delete several (Eva, 4 November). */
const typeView = (
  group: GarmentGroup,
  type: PieceType,
  pieces: ReadonlyArray<Piece>,
  model: Model,
  browse: Browse,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const shown = shownPieces(pieces, browse)
  const selecting = WardrobeSelect.Model.guards.On(model.selection)
  const toggle = selectSlot('wardrobe-select', WardrobeSelectView.toggle, shown, model, locale, h)
  return [
    levelHead(
      backTo(
        browseRouter({ browse: browseGroup(group) }),
        format(locale, 'wardrobe.backToGroup', { group: format(locale, groupName(group), {}) }),
        h,
      ),
      // A category of the person's own is named as they named it (T-12).
      Option.getOrElse(browse.category, () => format(locale, typeName(type), {})),
      selecting ? [toggle] : [filtersButton(model, browse, locale, h), ...(shown.length === 0 ? [] : [toggle])],
      h,
    ),
    Option.match(browse.category, {
      onNone: () => h.empty,
      onSome: (name) => categoryEditView(model, name, type, locale, h),
    }),
    shown.length === 0
      ? h.p(styled(h, styles.message()), [format(locale, 'wardrobe.noneFiltered', {})])
      : selecting
        ? selectSlot('wardrobe-ticks', WardrobeSelectView.ticks, shown, model, locale, h)
        : h.ul(
            styled(h, styles.grid()),
            shown.map((piece) => pieceTile(piece, browse, locale, h)),
          ),
    sheetShown(model.filterSheet) ? filterSheet(pieces, model, browse, locale, h) : h.empty,
  ]
}

/** One step of browsing (owner, 2026-11-03, T-07): the groups, a group's types, or a type's pieces. */
const levelView = (
  pieces: ReadonlyArray<Piece>,
  model: Model,
  browse: Browse,
  locale: Locale,
  h: HtmlBuilder<Message>,
) => {
  const inGroup = (group: GarmentGroup) => pieces.filter((piece) => groupOf(piece.type) === group)
  if (Option.isNone(browse.group))
    return [
      categoryCards(
        format(locale, 'wardrobe.filterCategories', {}),
        GarmentGroup.literals.map((group) => ({
          name: format(locale, groupName(group), {}),
          href: browseRouter({ browse: browseGroup(group) }),
          pieces: inGroup(group),
        })),
        h,
      ),
    ]
  const group = browse.group.value
  const pieceOfGroup = inGroup(group)
  if (Option.isSome(browse.type)) return typeView(group, browse.type.value, pieceOfGroup, model, browse, locale, h)
  const groupLabel = format(locale, groupName(group), {})
  return [
    levelHead(backToWardrobe(locale, h), groupLabel, [], h),
    pieceOfGroup.length === 0
      ? h.p(styled(h, styles.message()), [format(locale, 'wardrobe.noneFiltered', {})])
      : categoryCards(
          groupLabel,
          [
            // The shop's types hold the pieces of no category of the person's own; each of theirs is a card too.
            ...typesIn(group).map((type) => ({
              name: format(locale, typeName(type), {}),
              href: browseRouter({ browse: browseType(type) }),
              pieces: pieceOfGroup.filter((piece) => piece.type === type && piece.category === null),
            })),
            ...categoriesOf(pieceOfGroup).map(({ type, name }) => ({
              name,
              href: browseRouter({ browse: browseType(type, Option.some(name)) }),
              pieces: pieceOfGroup.filter((piece) => piece.type === type && piece.category === name),
            })),
          ],
          h,
        ),
  ]
}

const loadedView = (
  pieces: ReadonlyArray<Piece>,
  model: Model,
  browse: Browse,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  pieces.length === 0
    ? h.section(styled(h, styles.message()), [
        h.h2(styled(h, styles.messageTitle()), [format(locale, 'wardrobe.closetEmptyTitle', {})]),
        h.p([], [format(locale, 'wardrobe.emptyHint', {})]),
        // The head's + is the page's one ink action; this one says the same quietly, as Looks' does.
        h.a(
          [h.Href(addPiecesRouter({})), ...styled(h, secondaryAction())],
          [format(locale, 'wardrobe.scanPhotosCta', {})],
        ),
      ])
    : h.div(styled(h, styles.wardrobePage()), levelView(pieces, model, browse, locale, h))

const skeletonCards = ['a', 'b', 'c', 'd'] as const

/** The shape of what is coming: the category cards, where the groups will be. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.wardrobePage()), [
    loadingStatus(format(locale, 'wardrobe.shelves.loadingPieces', {}), h),
    placeholderList(
      { list: styles.categories(), slots: skeletonCards, item: cx(block(), styles.categorySkeleton()), content: [] },
      h,
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

/** The person's pieces on paper, browsed by group and type as a shop is (Gallery `wardrobe.html`; T-07). */
export const view = Submodel.defineView<
  Model,
  Message,
  { readonly locale: Locale; readonly pieces: PiecesData; readonly browse: Browse }
>((model, { locale, pieces, browse }, h) =>
  wardrobeMain(
    styles.wardrobePage(),
    [
      AsyncData.matchData(pieces, {
        onEmpty: () => loadingView(locale, h),
        onFailure: () => failedView(locale, h),
        onData: (shown) => loadedView(shown, model, browse, locale, h),
      }),
    ],
    locale,
    h,
  ),
)
