import { format, type Locale } from '@styld/i18n'
import { Category, type Piece } from '@styld/protocol'
import { Array, Option, String } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { addIcon, boardsTabIcon, cameraIcon, closeIcon, loader, searchIcon, stylistIcon } from '../Icon.ts'
import { accountRouter, addPiecesRouter, boardsRouter, pieceRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Message, type Model } from './Ask.ts'
import { Pieces } from './Wardrobe.ts'
import * as styles from './AskView.styles.ts'
import { categoryName, colourName, subcategoryName } from './WardrobeWords.ts'
import { pageHead, pageTitle } from './PageHead.ts'

const sheetId = 'ask-add-sheet'

/** Everything a piece answers to in this language: its name, category, shelf and colours. */
const wordsOf = (piece: Piece, locale: Locale) =>
  String.toLowerCase(
    [
      piece.name ?? '',
      format(locale, categoryName(piece.category), {}),
      piece.subcategory === null ? '' : format(locale, subcategoryName(piece.subcategory), {}),
      ...piece.colours.map((colour) => format(locale, colourName(colour), {})),
    ].join(' '),
  )

/** The pieces that match every word of the query.
 * @internal Exported for its tests. */
export const matching = (pieces: ReadonlyArray<Piece>, query: string, locale: Locale): ReadonlyArray<Piece> => {
  const words = Array.filter(String.split(String.toLowerCase(query.trim()), /\s+/), String.isNonEmpty)
  return Array.filter(pieces, (piece) => {
    const text = wordsOf(piece, locale)
    return piece.status === 'ready' && Array.every(words, (word) => text.includes(word))
  })
}

const searchBar = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.bar()), [
    h.label(styled(h, styles.search()), [
      searchIcon(h),
      h.input([
        h.Type('search'),
        h.AriaLabel(format(locale, 'ask.searchLabel', {})),
        h.Placeholder(format(locale, 'ask.placeholder', {})),
        h.Value(model.query),
        h.Autocomplete('off'),
        ...styled(h, styles.searchInput()),
        h.OnInput((value) => Message.UpdatedQuery({ value })),
      ]),
      String.isNonEmpty(model.query)
        ? h.button(
            [
              h.Type('button'),
              h.AriaLabel(format(locale, 'ask.clear', {})),
              ...styled(h, styles.clear()),
              h.OnClick(Message.ClickedClear()),
            ],
            [closeIcon(h)],
          )
        : h.empty,
    ]),
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(format(locale, 'ask.add', {})),
        h.AriaExpanded(model.isAdding),
        h.AriaControls(sheetId),
        ...styled(h, styles.add()),
        h.OnClick(Message.ClickedAdd()),
      ],
      [addIcon(h)],
    ),
  ])

const option = (href: string, icon: Html, title: string, hint: string, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(href), ...styled(h, styles.option())],
    [
      h.span(styled(h, styles.optionIcon()), [icon]),
      h.span([], [title]),
      h.span(styled(h, styles.optionHint()), [hint]),
    ],
  )

/** The + sheet: add clothes, or start a board. */
const addSheet = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Id(sheetId), ...styled(h, styles.sheet())],
    [
      option(
        addPiecesRouter({}),
        cameraIcon(h),
        format(locale, 'ask.addClothes', {}),
        format(locale, 'ask.addClothesHint', {}),
        h,
      ),
      option(
        boardsRouter({}),
        boardsTabIcon(h),
        format(locale, 'ask.newBoard', {}),
        format(locale, 'ask.newBoardHint', {}),
        h,
      ),
    ],
  )

const suggestions = (pieces: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const present = Array.filter(Category.literals, (category) => pieces.some((piece) => piece.category === category))
  return h.section(styled(h, styles.section()), [
    h.h2([], [format(locale, 'ask.suggestions', {})]),
    h.div(
      styled(h, styles.chips()),
      Array.map(present, (category) => {
        const word = format(locale, categoryName(category), {})
        return h.button(
          [h.Type('button'), ...styled(h, styles.chip()), h.OnClick(Message.ClickedSuggestion({ query: word }))],
          [word],
        )
      }),
    ),
  ])
}

const resultsView = (pieces: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const found = matching(pieces, model.query, locale)
  return h.section(styled(h, styles.section()), [
    h.p([h.Role('status'), ...styled(h, styles.count())], [format(locale, 'ask.found', { count: found.length })]),
    Array.match(found, {
      onEmpty: () => h.p(styled(h, styles.note()), [format(locale, 'ask.noResults', { query: model.query.trim() })]),
      onNonEmpty: (some) =>
        h.ul(
          styled(h, styles.results()),
          Array.map(some, (piece) =>
            h.keyed('li')(
              piece.id,
              [],
              [
                h.a(
                  [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.result())],
                  [
                    h.img([
                      h.Src(`/cdn/pieces/${piece.id}/thumb`),
                      h.Alt(''),
                      h.Loading('lazy'),
                      ...styled(h, styles.resultImage()),
                    ]),
                    piece.name ?? format(locale, categoryName(piece.category), {}),
                  ],
                ),
              ],
            ),
          ),
        ),
    }),
  ])
}

const wardrobeView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Pieces.match(model.wardrobe.pieces, {
    Loading: () => h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h)]),
    Failed: () =>
      h.div(styled(h, styles.section()), [
        h.p([h.Role('alert')], [format(locale, 'ask.failed', {})]),
        actionButton(
          {
            label: format(locale, 'ask.retry', {}),
            style: secondaryAction(),
            onClick: Message.ClickedRetry(),
          },
          h,
        ),
      ]),
    Loaded: ({ pieces }) =>
      String.isNonEmpty(model.query.trim()) ? resultsView(pieces, model, locale, h) : suggestions(pieces, locale, h),
  })

/** The stylist lives in ChatGPT and Claude, with the wardrobe connected; the website hands over. */
const stylistView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(styled(h, styles.stylist()), [
    h.h2([], [format(locale, 'ask.stylistTitle', {})]),
    h.p(styled(h, styles.note()), [format(locale, 'ask.stylistText', {})]),
    h.a([h.Href(accountRouter({}))], [stylistIcon(h), ' ', format(locale, 'ask.stylistLink', {})]),
  ])

export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.page())],
    [
      pageHead(pageTitle(format(locale, 'ask.title', {}), h), Option.none(), h),
      searchBar(model, locale, h),
      model.isAdding ? addSheet(locale, h) : h.empty,
      wardrobeView(model, locale, h),
      stylistView(locale, h),
    ],
  ),
)
