import { Button } from '@foldkit/ui'
import type { Category, Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction } from '../Actions.styles.ts'
import { loader } from '../Icon.ts'
import { addPiecesRouter, pieceRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { categories } from './PieceFields.ts'
import { Message, type Model } from './Wardrobe.ts'
import { categoryName, pieceLabel } from './WardrobeWords.ts'
import * as styles from './WardrobeView.styles.ts'
import { wardrobeMain } from './WardrobeTabs.ts'
import { chip } from './AskView.styles.ts'
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
            ...styled(h, cx(chip(), chosen(), styles.categoryFilter())),
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
      h.p([], [format(locale, 'wardrobe.emptyHint', {})]),
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
    backfillLine(model, locale, h),
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

const skeletonTiles = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/** The shape of what is coming: the category row and six captioned squares, where the pieces will be. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.wardrobePage()), [
    h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'wardrobe.shelves.loadingPieces', {})]),
    h.div(
      [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.categoryRowSkeleton())],
      [
        h.span(styled(h, cx(line(), styles.filterSkeleton()))),
        h.span(styled(h, cx(line(), styles.filterSkeleton()))),
        h.span(styled(h, cx(line(), styles.filterSkeleton()))),
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

/** The person's pieces on paper, filtered by category (Gallery `wardrobe.html`). */
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
