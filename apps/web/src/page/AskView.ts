import { Button, Dialog } from '@foldkit/ui'
import { format, type Locale } from '@styld/i18n'
import { Category, type Colour, type Piece } from '@styld/protocol'
import { Array, Option, Order, String } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { addIcon, boardsTabIcon, cameraIcon, closeIcon, linkIcon, loader, searchIcon, stylistIcon } from '../Icon.ts'
import { accountRouter, addPiecesRouter, assistantsSection, pieceRouter, stylistRouter } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { Creating } from './Boards.ts'
import { sheetShown } from './Sheet.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { Message, type Model, resultsId, SearchLanguages, searchFieldId } from './Ask.ts'
import { matching } from './AskSearch.ts'
import * as styles from './AskView.styles.ts'
import { round } from './PageBar.styles.ts'
import { pageHead, pageTitle } from './PageHead.ts'
import type { PiecesData } from './Wardrobe.ts'
import { categoryName, colourName, pieceLabel } from './WardrobeWords.ts'
import { personTile } from './ExploreView.ts'
import * as exploreStyles from './ExploreView.styles.ts'
import { boardCard, byline } from './PublicTiles.ts'

/** The languages the search reads a piece's words in: the page's first, and the other once it has loaded. */
const searchLocales = (model: Model, locale: Locale): ReadonlyArray<Locale> =>
  SearchLanguages.guards.Both(model.languages) ? [locale, locale === 'sl' ? 'en' : 'sl'] : [locale]

const isReady = (piece: Piece) => piece.status === 'ready'

/** The search pill (the prototype's `.askbar`): a field that says what it searches, then a quiet clear and the +
 * that opens the sheet. Enter shows what was found; the search stays in the address. */
const searchForm = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Role('search'), h.OnSubmit(Message.SubmittedSearch()), ...styled(h, styles.search())],
    [
      searchIcon(h),
      h.input([
        h.Id(searchFieldId),
        h.Type('search'),
        h.Name('q'),
        h.AriaLabel(format(locale, 'ask.searchLabel', {})),
        h.Placeholder(format(locale, 'ask.placeholder', {})),
        h.Value(model.query),
        h.Autocomplete('off'),
        h.Attribute('enterkeyhint', 'search'),
        h.Attribute('autocapitalize', 'none'),
        h.Attribute('autocorrect', 'off'),
        h.Attribute('spellcheck', 'false'),
        ...styled(h, styles.searchInput()),
        h.OnInput((value) => Message.UpdatedQuery({ value })),
      ]),
      String.isNonEmpty(model.query)
        ? h.button(
            [
              h.Type('button'),
              h.AriaLabel(format(locale, 'ask.clear', {})),
              ...styled(h, cx(round(), styles.quiet(), styles.clear())),
              h.OnClick(Message.ClickedClear()),
            ],
            [closeIcon(h)],
          )
        : h.empty,
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'ask.add', {})),
          h.Attribute('aria-haspopup', 'dialog'),
          h.AriaExpanded(model.addSheet.isOpen),
          ...styled(h, cx(round(), styles.quiet())),
          h.OnClick(Message.ClickedAdd()),
        ],
        [addIcon(h)],
      ),
    ],
  )

/** The most common colours among the pieces, at most three. */
const commonColours = (pieces: ReadonlyArray<Piece>): ReadonlyArray<Colour> => {
  const counts = new Map<Colour, number>()
  for (const colour of pieces.flatMap((piece) => piece.colours)) counts.set(colour, (counts.get(colour) ?? 0) + 1)
  const byCount = Order.mapInput(Order.Number, ([, count]: readonly [Colour, number]) => -count)
  return Array.take(Array.sort([...counts.entries()], byCount), 3).map(([colour]) => colour)
}

/** What the wardrobe holds, to search with a tap: the kinds of pieces, then the commonest colours. */
const suggestionsView = (ready: ReadonlyArray<Piece>, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const words = [
    ...Array.filter(Category.literals, (category) => ready.some((piece) => piece.category === category)).map(
      (category) => format(locale, categoryName(category), {}),
    ),
    ...commonColours(ready).map((colour) => format(locale, colourName(colour), {})),
  ]
  return h.div(
    [h.Role('group'), h.AriaLabel(format(locale, 'ask.suggestions', {})), ...styled(h, styles.chips())],
    words.map((word) =>
      h.button(
        [h.Type('button'), ...styled(h, styles.chip()), h.OnClick(Message.ClickedSuggestion({ query: word }))],
        [word],
      ),
    ),
  )
}

const skeletonChips = ['a', 'b', 'c', 'd'] as const

const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
      h.div(
        [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.chips())],
        skeletonChips.map((slot) => h.keyed('span')(slot, styled(h, cx(block(), styles.chipSkeleton())))),
      ),
    ],
  )

const emptyView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(styled(h, styles.empty()), [
    h.h2(styled(h, styles.emptyTitle()), [format(locale, 'ask.emptyTitle', {})]),
    h.p([], [format(locale, 'ask.emptyHint', {})]),
    h.a([h.Href(addPiecesRouter({})), ...styled(h, primaryAction())], [format(locale, 'ask.addClothes', {})]),
  ])

const resultTile = (piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    piece.id,
    [],
    [
      h.a(
        [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.result())],
        [
          // The caption names the piece; the picture would only say it twice.
          h.img([
            h.Src(`/cdn/pieces/${piece.id}/thumb`),
            h.Alt(''),
            h.Loading('lazy'),
            ...styled(h, styles.resultImage()),
          ]),
          h.span(styled(h, styles.resultName()), [pieceLabel(piece, locale)]),
        ],
      ),
    ],
  )

/** What was found, under a head that says where and how many; nothing found says so once and offers a way on. */
const resultsView = (ready: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const found = matching(ready, model.query, searchLocales(model, locale))
  return h.section(
    [h.Id(resultsId), h.AriaLabelledBy(`${resultsId}-title`), ...styled(h, styles.section())],
    [
      h.div(styled(h, styles.resultsHead()), [
        h.h2([h.Id(`${resultsId}-title`), ...styled(h, styles.resultsTitle())], [format(locale, 'ask.inWardrobe', {})]),
        h.span(
          [h.AriaLive('polite'), ...styled(h, styles.count())],
          [found.length > 0 ? format(locale, 'ask.found', { count: found.length }) : ''],
        ),
      ]),
      Array.match(found, {
        onEmpty: () =>
          h.div(styled(h, styles.nothingFound()), [
            h.p([], [format(locale, 'ask.noResults', { query: model.query.trim() })]),
            actionButton(
              { label: format(locale, 'ask.clear', {}), style: secondaryAction(), onClick: Message.ClickedClear() },
              h,
            ),
            suggestionsView(ready, locale, h),
          ]),
        onNonEmpty: (some) =>
          h.ul(
            styled(h, styles.results()),
            Array.map(some, (piece) => resultTile(piece, locale, h)),
          ),
      }),
    ],
  )
}

/** People and public boards for the same words, once the server has answered for them. */
const publicResults = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(
    Option.filter(model.found, ({ query }) => query === model.query),
    {
      onNone: () => h.empty,
      onSome: ({ results }) =>
        h.div(styled(h, styles.section()), [
          results.people.length === 0
            ? h.empty
            : h.section(
                [h.AriaLabelledBy('ask-people'), ...styled(h, styles.section())],
                [
                  h.h2(
                    [h.Id('ask-people'), ...styled(h, styles.resultsTitle())],
                    [format(locale, 'profile.public.people', {})],
                  ),
                  h.ul(
                    styled(h, exploreStyles.people()),
                    results.people.map((person) => personTile(person, h)),
                  ),
                ],
              ),
          results.boards.length === 0
            ? h.empty
            : h.section(
                [h.AriaLabelledBy('ask-boards'), ...styled(h, styles.section())],
                [
                  h.h2(
                    [h.Id('ask-boards'), ...styled(h, styles.resultsTitle())],
                    [format(locale, 'profile.public.boards', {})],
                  ),
                  h.ul(
                    styled(h, exploreStyles.boards()),
                    results.boards.map(({ board, by }) =>
                      h.keyed('li')(board.id, [], [boardCard(board, locale, h), byline(by, locale, h)]),
                    ),
                  ),
                ],
              ),
        ]),
    },
  )

const wardrobeView = (model: Model, pieces: PiecesData, locale: Locale, h: HtmlBuilder<Message>): Html =>
  AsyncData.matchData(pieces, {
    onEmpty: () => loadingView(locale, h),
    onFailure: () =>
      h.div(styled(h, styles.section()), [
        h.p([h.Role('alert')], [format(locale, 'ask.failed', {})]),
        actionButton(
          { label: format(locale, 'ask.retry', {}), style: secondaryAction(), onClick: Message.ClickedRetry() },
          h,
        ),
      ]),
    onData: (list) => {
      const ready = list.filter(isReady)
      if (Array.isReadonlyArrayEmpty(ready)) return emptyView(locale, h)
      return String.isNonEmpty(model.query.trim())
        ? h.div(styled(h, styles.section()), [
            resultsView(ready, model, locale, h),
            publicResults(model, locale, h),
            askStyld(model.query.trim(), locale, h),
          ])
        : suggestionsView(ready, locale, h)
    },
  })

/** Styld, the stylist in the app, with the wardrobe it knows; ChatGPT and Claude answer too once connected, from the
 * account's section on connecting one. */
const stylistView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(styled(h, styles.stylist()), [
    h.h2([], [format(locale, 'ask.stylistTitle', {})]),
    h.p(styled(h, styles.note()), [format(locale, 'ask.stylistText', {})]),
    h.a(
      [h.Href(stylistRouter({ q: Option.none() })), ...styled(h, primaryAction())],
      [stylistIcon(h), format(locale, 'ask.stylistLink', {})],
    ),
    h.a([h.Href(`${accountRouter({})}#${assistantsSection}`)], [format(locale, 'ask.stylistAssistants', {})]),
  ])

/** What was typed, asked of Styld instead of searched. */
const askStyld = (query: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(stylistRouter({ q: Option.some(query) })), ...styled(h, secondaryAction())],
    [stylistIcon(h), format(locale, 'ask.askStyld', { query })],
  )

const option = (
  href: string,
  icon: Html,
  title: string,
  hint: string,
  focus: ReadonlyArray<Dialog.RenderInfo['initialFocus'][number]>,
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [h.Href(href), ...focus, ...styled(h, styles.option())],
    [
      h.span(styled(h, styles.optionIcon()), [icon]),
      h.span([], [title]),
      h.span(styled(h, styles.optionHint()), [hint]),
    ],
  )

/** The + sheet rises from the bottom edge: add clothes, or start a board. Escape, the scrim and the close button
 * shut it; focus moves in and back. Drawn only while open: the dialog's own layout is set in the browser. */
/** Start a board: makes one under the default name through Boards, as its + does, and says so while it is made and
 * if it was refused. */
const startBoardOption = (start: Creating, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      Button.view(
        {
          onClick: Message.ClickedNewBoard({ defaultName: format(locale, 'boards.defaultName', {}) }),
          isDisabled: Creating.guards.Sending(start),
          toView: (attributes) =>
            h.button(
              [...attributes.button, h.AriaBusy(Creating.guards.Sending(start)), ...styled(h, styles.option())],
              [
                h.span(styled(h, styles.optionIcon()), [Creating.guards.Sending(start) ? loader(h) : boardsTabIcon(h)]),
                h.span([], [format(locale, 'ask.newBoard', {})]),
                h.span(styled(h, styles.optionHint()), [
                  format(locale, Creating.guards.Sending(start) ? 'boards.creating' : 'ask.newBoardHint', {}),
                ]),
              ],
            ),
        },
        h,
      ),
      Creating.guards.Failed(start)
        ? h.p([h.Role('alert'), ...styled(h, styles.optionProblem())], [format(locale, 'boards.createFailed', {})])
        : h.empty,
    ],
  )

const addSheetView = (model: Model, locale: Locale, h: HtmlBuilder<Message>, start: Creating): Html =>
  h.submodel({
    slotId: 'ask-add-sheet',
    model: model.addSheet,
    view: Dialog.view,
    viewInputs: {
      toView: (info: Dialog.RenderInfo) =>
        h.dialog(
          [...info.dialog],
          [
            h.div([...info.backdrop, ...styled(h, styles.scrim())]),
            h.div(
              [...info.panel, ...styled(h, styles.sheet())],
              [
                h.span([h.AriaHidden(true), ...styled(h, styles.grab())]),
                h.div(styled(h, styles.sheetHead()), [
                  h.h2([...info.title, ...styled(h, styles.sheetTitle())], [format(locale, 'ask.sheetTitle', {})]),
                  h.button(
                    [
                      ...info.closeButton,
                      h.AriaLabel(format(locale, 'common.close', {})),
                      ...styled(h, cx(round(), styles.quiet())),
                    ],
                    [closeIcon(h)],
                  ),
                ]),
                option(
                  addPiecesRouter({}),
                  cameraIcon(h),
                  format(locale, 'ask.addClothes', {}),
                  format(locale, 'ask.addClothesHint', {}),
                  info.initialFocus,
                  h,
                ),
                option(
                  `${addPiecesRouter({})}#link`,
                  linkIcon(h),
                  format(locale, 'ask.addLink', {}),
                  format(locale, 'ask.addLinkHint', {}),
                  [],
                  h,
                ),
                startBoardOption(start, locale, h),
              ],
            ),
          ],
        ),
    },
    toParentMessage: (message) => Message.GotAddSheetMessage({ message }),
  })

export const view = Submodel.defineView<
  Model,
  Message,
  { readonly locale: Locale; readonly pieces: PiecesData; readonly boardStart: Creating }
>((model, { locale, pieces, boardStart }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.page())],
    [
      pageHead(pageTitle(format(locale, 'ask.title', {}), h), Option.none(), h),
      searchForm(model, locale, h),
      wardrobeView(model, pieces, locale, h),
      // While searching, Styld is the one row under the results; the card would ask the same thing twice.
      String.isNonEmpty(model.query.trim()) ? h.empty : stylistView(locale, h),
      sheetShown(model.addSheet) ? addSheetView(model, locale, h, boardStart) : h.empty,
    ],
  ),
)
