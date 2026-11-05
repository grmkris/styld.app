import { format, type Locale } from '@styld/i18n'
import type { FeedItem, PublicLook, PublicPin } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { avatar } from '../Avatar.ts'
import { loader } from '../Icon.ts'
import { boardRouter, lookRouter, publicPieceRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { publicPicture, publicPieceImage } from './Board/Table.ts'
import { generatedPiecesMark } from './Board/MakeView.ts'
import { publicFace } from './PublicTiles.ts'
import { itemKey, Message, type Model, More, stripLength, WatchListEnd } from './WhatsNew.ts'
import * as styles from './WhatsNewView.styles.ts'
import { loadingStatus, placeholderList } from '../Loading.ts'

// What's new, drawn twice on Home: the newest along a strip near the top, and the rest at its foot. Every item is
// the same card (its picture at 4:5, its name, whose it is), so the strip keeps its height from skeleton to content.

/** Up to four of a look's pieces, two by two, on paper. */
const lookPicture = (look: PublicLook, h: HtmlBuilder<Message>): Html =>
  h.span(
    styled(h, styles.mosaic()),
    Array.map(Array.take(look.pieces, 4), (piece) =>
      h.img([h.Src(publicPieceImage(piece.id)), h.Alt(''), h.Loading('lazy')]),
    ),
  )

/** A pin's picture: a piece's cut-out on paper, a picture as it was taken, a look's pieces. */
const pinPicture = (pin: PublicPin, h: HtmlBuilder<Message>): Html =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PublicPiecePin: ({ piece }) =>
        h.img([h.Src(publicPieceImage(piece.id)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.cutout())]),
      PublicPicturePin: ({ imageId }) =>
        h.img([h.Src(publicPicture(imageId, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.photo())]),
      PublicLookPin: ({ look }) => lookPicture(look, h),
    }),
  )

/** Where an item leads, what it is called and its picture. */
const partsOf = (item: FeedItem, locale: Locale, h: HtmlBuilder<Message>) =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      BoardWentPublic: ({ board }) => ({
        href: boardRouter({ boardId: board.id }),
        name: board.name,
        picture: publicFace(board, locale, h),
        generated: board.generated,
      }),
      PinnedOnBoard: ({ pin, boardId, boardName }) => ({
        href: Match.value(pin).pipe(
          Match.tag('PublicPiecePin', ({ piece }) => publicPieceRouter({ pieceId: piece.id })),
          Match.tag('PublicLookPin', ({ look }) => lookRouter({ lookId: look.id })),
          Match.orElse(() => boardRouter({ boardId })),
        ),
        name: boardName,
        picture: h.span(styled(h, styles.paper()), [pinPicture(pin, h)]),
        generated: Match.value(pin).pipe(
          Match.tag('PublicPiecePin', ({ piece }) => piece.generated),
          Match.tag('PublicLookPin', ({ look }) => look.generated),
          Match.tag('PublicPicturePin', ({ generated }) => generated),
          Match.exhaustive,
        ),
      }),
      SharedLook: ({ look }) => ({
        href: lookRouter({ lookId: look.id }),
        name: look.name,
        picture: h.span(styled(h, styles.paper()), [lookPicture(look, h)]),
        generated: look.generated,
      }),
    }),
  )

/** One thing someone made public: the card is the link, with whose it is as text inside it. */
const itemCard = (item: FeedItem, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { href, name, picture, generated } = partsOf(item, locale, h)
  return h.a(
    [h.Href(href), ...styled(h, styles.card())],
    [
      h.span(styled(h, styles.picture()), [picture]),
      h.span(styled(h, styles.name()), [name]),
      generated ? generatedPiecesMark(locale, h) : h.empty,
      h.span(styled(h, styles.by()), [
        avatar(item.by.name, item.by.tone, 'small', h),
        h.span(styled(h, styles.byName()), [format(locale, 'share.byline', { name: item.by.name })]),
      ]),
    ],
  )
}

const cardList = (
  items: ReadonlyArray<FeedItem>,
  listStyle: 'strip' | 'grid',
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.ul(
    styled(h, listStyle === 'strip' ? styles.strip() : styles.grid()),
    items.map((item) =>
      h.keyed('li')(
        itemKey(item),
        [h.Id(`whats-new-${itemKey(item)}`), ...styled(h, styles.slot())],
        [itemCard(item, locale, h)],
      ),
    ),
  )

const skeletonCards = ['a', 'b', 'c'] as const

/** The strip's shape while the newest come: three cards' outlines, as tall as the cards that replace them. */
const stripSkeleton = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.stripBox()), [
    placeholderList(
      {
        list: styles.strip(),
        slots: skeletonCards,
        item: styles.slot(),
        content: [
          h.span(styled(h, styles.card()), [
            h.span(styled(h, cx(block(), styles.picture()))),
            h.span(styled(h, cx(line(), styles.name()))),
            h.span(styled(h, cx(line(), styles.by()))),
          ]),
        ],
      },
      h,
    ),
    loadingStatus(format(locale, 'common.loading', {}), h),
  ])

/** The strip when there is nothing to show, or the newest did not load: one line in the strip's own height. */
const stripLine = (text: string, retry: Option.Option<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, cx(styles.stripBox(), styles.stripLine())), [
    h.p(styled(h, styles.lineText()), [text]),
    Option.getOrElse(retry, () => h.empty),
  ])

const retryButton = (onClick: Message, locale: Locale, h: HtmlBuilder<Message>): Html =>
  actionButton({ label: format(locale, 'today.retry', {}), style: secondaryAction(), onClick }, h)

/** What's new near the top of Home: the newest few along a strip that scrolls sideways. */
const strip = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('whats-new'), ...styled(h, styles.section())],
    [
      h.h2([h.Id('whats-new'), ...styled(h, styles.title())], [format(locale, 'today.whatsNew', {})]),
      Option.match(AsyncData.getData(model.feed), {
        onSome: ({ items }) =>
          Array.isReadonlyArrayEmpty(items)
            ? stripLine(format(locale, 'today.whatsNewEmpty', {}), Option.none(), h)
            : h.div(styled(h, styles.stripBox()), [cardList(Array.take(items, stripLength), 'strip', locale, h)]),
        onNone: () =>
          AsyncData.isFailure(model.feed)
            ? stripLine(
                format(locale, 'today.whatsNewFailed', {}),
                Option.some(retryButton(Message.ClickedRetry(), locale, h)),
                h,
              )
            : stripSkeleton(locale, h),
      }),
    ],
  )

/** The foot of the list: Show more while there is a next page (and the sentinel that reads it as it nears the
 * screen), its status while it comes, or what failed with Try again. */
const moreView = (more: More, cursor: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.more()), [
    h.keyed('div')(`more-${cursor}`, [
      h.AriaHidden(true),
      h.OnMount(WatchListEnd({ cursor })),
      ...styled(h, styles.sentinel()),
    ]),
    More.match(more, {
      Idle: () =>
        actionButton(
          {
            label: format(locale, 'today.showMore', {}),
            style: secondaryAction(),
            onClick: Message.ClickedShowMore({ cursor }),
          },
          h,
        ),
      Loading: () =>
        h.p([h.Role('status'), ...styled(h, styles.loading())], [loader(h), format(locale, 'today.loadingMore', {})]),
      Failed: () =>
        h.div(styled(h, styles.more()), [
          h.p([h.Role('alert'), ...styled(h, styles.lineText())], [format(locale, 'today.moreFailed', {})]),
          retryButton(Message.ClickedShowMore({ cursor }), locale, h),
        ]),
    }),
  ])

/** What's new at the foot of Home: everything after the strip, reading more as the person nears the end. */
const earlier = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(AsyncData.getData(model.feed), {
    onNone: () => h.empty,
    onSome: ({ items, cursor }) => {
      const rest = Array.drop(items, stripLength)
      if (Array.isReadonlyArrayEmpty(rest) && cursor === null) return h.empty
      return h.section(
        [h.AriaLabelledBy('whats-new-earlier'), ...styled(h, styles.section())],
        [
          h.h2(
            [h.Id('whats-new-earlier'), ...styled(h, styles.title())],
            [format(locale, 'today.whatsNewEarlier', {})],
          ),
          Array.isReadonlyArrayEmpty(rest) ? h.empty : cardList(rest, 'grid', locale, h),
          cursor === null ? h.empty : moreView(model.more, cursor, locale, h),
        ],
      )
    },
  })

/** What's new near the top of Home, as Today embeds it. */
export const stripView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  strip(model, locale, h),
)

/** What's new at the foot of Home, as Today embeds it. */
export const earlierView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  earlier(model, locale, h),
)
