import { cdn } from '../Cdn.ts'
import { prices } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import type { Photo } from '@styld/protocol'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { secondaryAction } from '../Actions.styles.ts'
import { favouriteOnIcon, loader } from '../Icon.ts'
import { intlLocale } from '../Locale.ts'
import { photoRouter } from '../route.ts'
import { block } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { pictureAccept } from '../Upload.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { retryView } from './Retry.ts'
import { Adding, Message, type Model } from './Photos.ts'
import * as styles from './PhotosView.styles.ts'
import { labMain } from './SectionMain.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'
import { spentWords } from './MoreCredits.ts'
import { loadingList } from '../Loading.ts'

interface Inputs {
  readonly locale: Locale
  readonly timeZone: string
}

/** The day a photo was added, in the person's own time zone: "31 Oct". */
export const photoDate = (createdAt: string, { locale, timeZone }: Inputs) =>
  new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone }).format(new Date(createdAt))

const tile = (photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    photo.id,
    [],
    [
      h.a(
        [
          h.Href(photoRouter({ photoId: photo.id })),
          h.AriaLabel(format(inputs.locale, 'photos.open', { date: photoDate(photo.createdAt, inputs) })),
          ...styled(h, styles.tile()),
        ],
        [
          h.img([h.Src(cdn.photo(photo, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.tileImage())]),
          photo.status === 'finding'
            ? h.span(styled(h, styles.badge()), [loader(h), format(inputs.locale, 'photos.finding', {})])
            : photo.favourite
              ? h.span(styled(h, styles.favouriteBadge()), [
                  favouriteOnIcon(h),
                  h.span(styled(h, visuallyHidden()), [format(inputs.locale, 'photos.favourite', {})]),
                ])
              : h.empty,
        ],
      ),
    ],
  )

/** Adding a photo: one at a time, for a credit, with how it went. */
const addView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Adding.guards.Sending(model.adding)
  return h.div(styled(h, styles.add()), [
    sending
      ? h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(locale, 'photos.sending', {})])
      : h.label(
          [h.For('add-photo'), ...styled(h, secondaryAction())],
          [
            format(locale, 'photos.add', {}),
            h.input([
              h.Id('add-photo'),
              h.Type('file'),
              h.Accept(pictureAccept),
              h.AriaDescribedBy('add-photo-cost'),
              h.OnFileChange((files) => Message.ChosePhoto({ files })),
              ...styled(h, visuallyHidden()),
            ]),
          ],
        ),
    h.p(
      [h.Id('add-photo-cost'), ...styled(h, styles.note())],
      [format(locale, 'photos.addCost', { credits: prices.galleryPhoto })],
    ),
    Adding.guards.Failed(model.adding)
      ? h.p(
          [h.Role('alert'), ...styled(h, styles.note())],
          spentWords(
            format(locale, model.adding.spent ? 'photos.spent' : 'photos.addFailed', {}),
            model.adding.spent,
            locale,
            h,
          ),
        )
      : h.empty,
  ])
}

const skeletonTiles = ['a', 'b'] as const

const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  loadingList(
    locale,
    { list: styles.grid(), slots: skeletonTiles, content: [h.span(styled(h, cx(block(), styles.tile())))] },
    h,
  )

const photosPage = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return labMain(
    'gallery',
    styles.photosPage(),
    Option.none(),
    AsyncData.matchData(model.photos, {
      onEmpty: () => loadingView(locale, h),
      onFailure: () => [retryView(format(locale, 'photos.loadFailed', {}), locale, Message.ClickedRetry(), h)],
      onData: (photos) =>
        photos.length === 0
          ? [
              // Empty, the one action that fills it (DESIGN › Copy).
              h.section(styled(h, messageSection()), [
                h.h2(styled(h, messageTitle()), [format(locale, 'photos.emptyTitle', {})]),
                h.p([], [format(locale, 'photos.emptyHint', {})]),
                addView(model, locale, h),
              ]),
            ]
          : [
              addView(model, locale, h),
              h.ul(
                styled(h, styles.grid()),
                photos.map((photo) => tile(photo, inputs, h)),
              ),
            ],
    }),
    locale,
    h,
  )
}

/** My Gallery: the person's own outfit photos, private. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) => photosPage(model, inputs, h))
