import { Button } from '@foldkit/ui'
import type { Category, Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction } from '../Actions.styles.ts'
import { addIcon, loader } from '../Icon.ts'
import { addPiecesRouter, pieceRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { categories } from './PieceFields.ts'
import { Message, type Model, Pieces } from './Wardrobe.ts'
import { categoryName, subcategoryName } from './WardrobeWords.ts'
import * as styles from './WardrobeView.styles.ts'

/** A piece's name, or what it is when it has none. */
export const pieceLabel = (piece: Piece, locale: Locale) =>
  piece.name ??
  format(locale, piece.subcategory === null ? categoryName(piece.category) : subcategoryName(piece.subcategory), {})

/** The small image of a piece; the API Worker serves it to its owner only. */
const thumbnailPath = (piece: Piece) => `/cdn/pieces/${piece.id}/thumb`

const sameFilter = (shown: Option.Option<Category>, filter: Option.Option<Category>) =>
  Option.isNone(filter) ? Option.isNone(shown) : Option.contains(shown, filter.value)

const filter = (
  label: string,
  total: number,
  category: Option.Option<Category>,
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      onClick: Message.ClickedCategory({ category }),
      toView: (attributes) =>
        h.button(
          [
            ...attributes.button,
            h.AriaPressed(String(sameFilter(model.category, category))),
            ...styled(h, styles.categoryFilter()),
          ],
          [label, ' ', h.span(styled(h, styles.count()), [String(total)])],
        ),
    },
    h,
  )

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
          h.img([h.Src(thumbnailPath(piece)), h.Alt(label), h.Loading('lazy'), ...styled(h, styles.cutImage())]),
          h.span(styled(h, styles.caption()), [label]),
          pieceState(piece, locale, h),
        ],
      ),
    ],
  )
}

const loadedView = (pieces: ReadonlyArray<Piece>, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (pieces.length === 0)
    return h.section(styled(h, styles.message()), [
      h.h2(styled(h, styles.messageTitle()), [format(locale, 'wardrobe.closetEmptyTitle', {})]),
      h.p([], [format(locale, 'wardrobe.createMenuAddPieceHint', {})]),
      h.a([h.Href(addPiecesRouter({})), ...styled(h, primaryAction())], [format(locale, 'wardrobe.scanPhotosCta', {})]),
    ])
  const shown = Option.match(model.category, {
    onNone: () => pieces,
    onSome: (category) => pieces.filter((piece) => piece.category === category),
  })
  const counted = categories
    .map((category) => ({ category, total: pieces.filter((piece) => piece.category === category).length }))
    .filter(({ total }) => total > 0)
  return h.div(styled(h, styles.wardrobePage()), [
    h.div(
      [
        h.Role('group'),
        h.AriaLabel(format(locale, 'wardrobe.filterCategories', {})),
        ...styled(h, styles.categoryRow()),
      ],
      [
        filter(format(locale, 'wardrobe.allItems', {}), pieces.length, Option.none(), model, h),
        ...counted.map(({ category, total }) =>
          filter(format(locale, categoryName(category), {}), total, Option.some(category), model, h),
        ),
      ],
    ),
    h.ul(
      styled(h, styles.grid()),
      shown.map((piece) => pieceTile(piece, locale, h)),
    ),
  ])
}

const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.wardrobePage()), [
    h.p(
      [h.Role('status'), ...styled(h, styles.pieceState())],
      [loader(h), format(locale, 'wardrobe.shelves.loadingPieces', {})],
    ),
    h.ul(
      [h.AriaHidden(true), ...styled(h, styles.grid())],
      Array.from({ length: 6 }, (_, index) => h.keyed('li')(String(index), styled(h, styles.placeholder()))),
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

/** The person's pieces on paper, filtered by category (Gallery `wardrobe.html`). */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.wardrobePage())],
    [
      h.div(styled(h, styles.pageHead()), [
        h.h1(styled(h, styles.pageTitle()), [format(locale, 'wardrobe.title', {})]),
        h.a(
          [
            h.Href(addPiecesRouter({})),
            h.AriaLabel(format(locale, 'capture.addTitle', {})),
            ...styled(h, styles.addRound()),
          ],
          [addIcon(h)],
        ),
      ]),
      Pieces.match(model.pieces, {
        Loading: () => loadingView(locale, h),
        Loaded: ({ pieces }) => loadedView(pieces, model, locale, h),
        Failed: () => failedView(locale, h),
      }),
    ],
  ),
)
