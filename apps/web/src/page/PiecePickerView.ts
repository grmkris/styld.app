import type { Dialog } from '@foldkit/ui'
import { format, type Locale } from '@styld/i18n'
import { GarmentGroup, groupOf, type Piece, type PieceType, typesIn } from '@styld/protocol'
import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { cdn } from '../Cdn.ts'
import { chip, chosen } from '../Controls.styles.ts'
import { checkIcon, searchIcon } from '../Icon.ts'
import type { PiecesData } from '../ServerData.ts'
import { styled } from '../Styled.ts'
import { matching } from './AskSearch.ts'
import * as askStyles from './AskView.styles.ts'
import * as boardStyles from './Board/PageView.styles.ts'
import type { PiecePicker } from './PiecePicker.ts'
import * as styles from './PiecePickerView.styles.ts'
import { bottomSheet, sheetShown } from './Sheet.ts'
import { groupName, pieceDescription, typeName } from './WardrobeWords.ts'

/** A chip that filters what a sheet offers, pressed while it applies; the new-board sheet's chips are these too. */
export const filterButton = <M>(label: string, pressed: boolean, message: M, h: HtmlBuilder<M>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(String(pressed)),
      h.OnClick(message),
      ...styled(h, cx(chip(), chosen(), styles.filter())),
    ],
    [label],
  )

/** All the pieces, or one garment group's: a chip each, the chosen one pressed. The new-board sheet's are these too. */
export const groupFilters = <M>(
  groups: ReadonlyArray<GarmentGroup>,
  current: Option.Option<GarmentGroup>,
  toMessage: (group: Option.Option<GarmentGroup>) => M,
  locale: Locale,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'wardrobe.filterCategories', {})), ...styled(h, styles.filters())],
    [
      filterButton(format(locale, 'wardrobe.allItems', {}), Option.isNone(current), toMessage(Option.none()), h),
      ...groups.map((group) =>
        filterButton(
          format(locale, groupName(group), {}),
          Option.contains(current, group),
          toMessage(Option.some(group)),
          h,
        ),
      ),
    ],
  )

/** What a page's picker sheet shows and the Messages it sends. */
export interface PickerConfig<M> {
  readonly picker: PiecePicker
  readonly pieces: PiecesData
  readonly locale: Locale
  readonly title: string
  /** What the sheet says when the wardrobe holds no ready piece. */
  readonly emptyWardrobe: string
  readonly messages: {
    readonly sheet: (message: Dialog.Message) => M
    readonly group: (group: Option.Option<GarmentGroup>) => M
    readonly type: (type: Option.Option<PieceType>) => M
    readonly query: (query: string) => M
    readonly piece: (piece: Piece) => M
  }
  /** A piece already where the choice would put it (on the board's table, matched to the garment): pressed, ticked. */
  readonly isChosen: (piece: Piece) => boolean
  /** The piece's button, said in full ("Put Black shirt on the table"). */
  readonly pieceLabel: (name: string, isChosen: boolean) => string
  /** What follows the pieces in the sheet: the board's pinned pictures, a photo's "None of my pieces". */
  readonly after: ReadonlyArray<Html>
}

const pieceButton = <M>(piece: Piece, config: PickerConfig<M>, h: HtmlBuilder<M>): Html => {
  const isChosen = config.isChosen(piece)
  const name = pieceDescription(piece, config.locale)
  return h.keyed('li')(piece.id, styled(h, styles.tile()), [
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(config.pieceLabel(name, isChosen)),
        h.AriaPressed(String(isChosen)),
        h.OnClick(config.messages.piece(piece)),
        ...styled(h, boardStyles.pick()),
      ],
      [
        h.img([h.Src(cdn.piece(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.image())]),
        isChosen ? h.span(styled(h, boardStyles.picked()), [checkIcon(h)]) : h.empty,
      ],
    ),
    h.span([h.AriaHidden(true), ...styled(h, styles.caption())], [name]),
  ])
}

const searchField = <M>({ picker, locale, messages }: PickerConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(styled(h, askStyles.search()), [
    searchIcon(h),
    h.input([
      h.Type('search'),
      h.AriaLabel(format(locale, 'piecePicker.search', {})),
      h.Placeholder(format(locale, 'piecePicker.search', {})),
      h.Value(picker.query),
      h.Autocomplete('off'),
      h.Attribute('enterkeyhint', 'search'),
      h.Attribute('autocapitalize', 'none'),
      h.Attribute('autocorrect', 'off'),
      h.Attribute('spellcheck', 'false'),
      ...styled(h, askStyles.searchInput()),
      h.OnInput(messages.query),
    ]),
  ])

/** The chosen group's types that hold a piece, as chips under the group's. */
const typeFilters = <M>(
  group: GarmentGroup,
  inGroup: ReadonlyArray<Piece>,
  { picker, locale, messages }: PickerConfig<M>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel(format(locale, groupName(group), {})), ...styled(h, styles.filters())],
    [
      filterButton(
        format(locale, 'wardrobe.allItems', {}),
        Option.isNone(picker.type),
        messages.type(Option.none()),
        h,
      ),
      ...typesIn(group)
        .filter((type) => inGroup.some((piece) => piece.type === type))
        .map((type) =>
          filterButton(
            format(locale, typeName(type), {}),
            Option.contains(picker.type, type),
            messages.type(Option.some(type)),
            h,
          ),
        ),
    ],
  )

const body = <M>(pieces: ReadonlyArray<Piece>, config: PickerConfig<M>, h: HtmlBuilder<M>): Html => {
  const { picker, locale } = config
  const ready = pieces.filter((piece) => piece.status === 'ready')
  const inGroup = Option.match(picker.group, {
    onNone: () => ready,
    onSome: (group) => ready.filter((piece) => groupOf(piece.type) === group),
  })
  const ofType = Option.match(picker.type, {
    onNone: () => inGroup,
    onSome: (type) => inGroup.filter((piece) => piece.type === type),
  })
  // A search reads the whole wardrobe, whatever the chips say: a piece kept under another kind than the one the sheet
  // opened on is found by its name, brand or colour. The chips step aside while something is typed.
  const searching = picker.query.trim().length > 0
  const shown = searching ? matching(ready, picker.query, [locale]) : ofType
  return h.div(styled(h, boardStyles.head()), [
    searchField(config, h),
    // Eight shop groups: only those holding a ready piece get a chip, and the one the sheet opened on.
    searching
      ? h.empty
      : groupFilters(
          GarmentGroup.literals.filter(
            (group) => Option.contains(picker.group, group) || ready.some((piece) => groupOf(piece.type) === group),
          ),
          picker.group,
          config.messages.group,
          locale,
          h,
        ),
    searching
      ? h.empty
      : Option.match(picker.group, {
          onNone: () => h.empty,
          onSome: (group) => typeFilters(group, inGroup, config, h),
        }),
    Array.match(shown, {
      onEmpty: () =>
        h.p(
          [h.Role('status'), ...styled(h, boardStyles.meta())],
          [ready.length === 0 ? config.emptyWardrobe : format(locale, 'piecePicker.noneFound', {})],
        ),
      onNonEmpty: (offered) =>
        h.ul(
          styled(h, boardStyles.pickGrid()),
          offered.map((piece) => pieceButton(piece, config, h)),
        ),
    }),
  ])
}

/** The sheet of the person's pieces, while it is shown. */
export const piecePickerSheet = <M>(config: PickerConfig<M>, h: HtmlBuilder<M>): Html =>
  sheetShown(config.picker.sheet)
    ? bottomSheet(
        {
          dialog: config.picker.sheet,
          title: config.title,
          locale: config.locale,
          toParentMessage: config.messages.sheet,
          body: () => [
            h.div(styled(h, boardStyles.sheetBody()), [
              AsyncData.matchData(config.pieces, {
                onEmpty: () => h.p([h.Role('status')], [format(config.locale, 'common.loading', {})]),
                onFailure: () => h.p([h.Role('alert')], [format(config.locale, 'piecePicker.failed', {})]),
                onData: (wardrobe) => body(wardrobe, config, h),
              }),
              ...config.after,
            ]),
          ],
        },
        h,
      )
    : h.empty
