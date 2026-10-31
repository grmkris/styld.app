import { format, type Locale } from '@styld/i18n'
import { type Photo, type PhotoGarment, type Piece, slotOf } from '@styld/protocol'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, quietLinkAction, secondaryAction } from '../Actions.styles.ts'
import { formError } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { lookRouter, reviewRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { backToGallery } from './PageBar.ts'
import { Deletion, Message, type Model, Shown, Work } from './Photo.ts'
import { photoDate } from './PhotosView.ts'
import * as styles from './PhotosView.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'

interface Inputs {
  readonly locale: Locale
  readonly timeZone: string
  readonly pieces: ReadonlyArray<Piece>
}

const pieceThumb = (piece: Piece, h: HtmlBuilder<Message>): Html =>
  h.img([h.Src(`/cdn/pieces/${piece.id}/thumb`), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.smallThumb())])

/** The wardrobe's pieces that sit where the garment does, or all of them when Styld could not tell what it is. */
const candidates = (garment: PhotoGarment, pieces: ReadonlyArray<Piece>) => {
  const ready = pieces.filter(({ status }) => status === 'ready')
  return garment.type === null ? ready : ready.filter(({ type }) => slotOf(type) === slotOf(garment.type ?? type))
}

const picker = (garment: PhotoGarment, { locale, pieces }: Inputs, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.match()), [
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'photo.pick', {})), ...styled(h, styles.picker())],
      candidates(garment, pieces).map((piece) =>
        actionButton(
          {
            label: pieceLabel(piece, locale),
            leading: pieceThumb(piece, h),
            style: styles.pick(),
            onClick: Message.ClickedMatch({ garmentId: garment.id, pieceId: piece.id }),
          },
          h,
        ),
      ),
    ),
    h.div(styled(h, styles.actions()), [
      actionButton(
        {
          label: format(locale, 'photo.noneOfThese', {}),
          style: secondaryAction(),
          onClick: Message.ClickedMatch({ garmentId: garment.id, pieceId: null }),
        },
        h,
      ),
      actionButton(
        { label: format(locale, 'common.cancel', {}), style: linkAction(), onClick: Message.ClickedCancelChoose() },
        h,
      ),
    ]),
  ])

const choose = (
  garment: PhotoGarment,
  labelKey: 'photo.notThis' | 'photo.change' | 'photo.pick',
  locale: Locale,
  h: HtmlBuilder<Message>,
) =>
  actionButton(
    {
      label: format(locale, labelKey, {}),
      style: linkAction(),
      onClick: Message.ClickedChoose({ garmentId: garment.id }),
    },
    h,
  )

/** What a garment is in the wardrobe, and what the person can do about it. */
const matchView = (garment: PhotoGarment, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale, pieces } = inputs
  const piece = Option.fromNullishOr(pieces.find(({ id }) => id === garment.pieceId))
  const named = (found: Piece) =>
    h.span(styled(h, styles.matchPiece()), [pieceThumb(found, h), pieceLabel(found, locale)])
  if (garment.match === 'offered')
    return h.div(styled(h, styles.match()), [
      h.p([], [format(locale, 'photo.offered', {})]),
      h.a([h.Href(reviewRouter({})), ...styled(h, linkAction())], [format(locale, 'photo.toReview', {})]),
    ])
  if (garment.match === 'suggested' && Option.isSome(piece))
    return h.div(styled(h, styles.match()), [
      h.p([], [format(locale, 'photo.isItThis', {})]),
      named(piece.value),
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'photo.yes', {}),
            style: secondaryAction(),
            onClick: Message.ClickedMatch({ garmentId: garment.id, pieceId: piece.value.id }),
          },
          h,
        ),
        choose(garment, 'photo.notThis', locale, h),
      ]),
    ])
  if (garment.match === 'confirmed' && Option.isSome(piece))
    return h.div(styled(h, styles.match()), [named(piece.value), choose(garment, 'photo.change', locale, h)])
  return h.div(styled(h, styles.match()), [
    h.p([], [format(locale, 'photo.notInWardrobe', {})]),
    h.div(styled(h, styles.actions()), [
      actionButton(
        {
          label: format(locale, 'photo.addToWardrobe', {}),
          style: secondaryAction(),
          onClick: Message.ClickedOffer({ garmentId: garment.id }),
        },
        h,
      ),
      choose(garment, 'photo.pick', locale, h),
    ]),
  ])
}

const garmentRow = (model: Model, photo: Photo, garment: PhotoGarment, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(garment.id, styled(h, styles.garment()), [
    h.img([
      h.Src(`/cdn/photos/${photo.id}/garments/${garment.id}`),
      h.Alt(''),
      h.Loading('lazy'),
      ...styled(h, styles.thumb()),
    ]),
    Option.contains(model.choosing, garment.id) ? picker(garment, inputs, h) : matchView(garment, inputs, h),
  ])

/** Favourite, Wear it again (or the look it made), and Delete. */
const actionsView = (model: Model, photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const confirmed = photo.garments.some(({ match, pieceId }) => match === 'confirmed' && pieceId !== null)
  return h.div(styled(h, styles.actions()), [
    photo.lookId === null
      ? confirmed
        ? actionButton(
            {
              label: format(locale, 'photo.wearAgain', {}),
              style: primaryAction(),
              onClick: Message.ClickedWearAgain({
                name: format(locale, 'photo.lookName', { date: photoDate(photo.createdAt, inputs) }),
              }),
              isDisabled: Work.guards.Sending(model.work),
            },
            h,
          )
        : h.empty
      : h.a(
          [h.Href(lookRouter({ lookId: photo.lookId })), ...styled(h, secondaryAction())],
          [format(locale, 'photo.openLook', {})],
        ),
    h.button(
      [
        h.Type('button'),
        h.AriaPressed(String(photo.favourite)),
        h.OnClick(Message.ClickedFavourite({ favourite: !photo.favourite })),
        ...styled(h, secondaryAction()),
      ],
      [format(locale, 'photos.favourite', {})],
    ),
    actionButton(
      {
        label: format(locale, 'photo.delete', {}),
        style: cx(linkAction(), quietLinkAction()),
        onClick: Message.ClickedDelete(),
      },
      h,
    ),
  ])
}

const deletionView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Deletion.guards.Idle(model.deletion)
    ? h.empty
    : h.section(
        [h.Role('alertdialog'), h.AriaLabel(format(locale, 'photo.delete', {})), ...styled(h, styles.confirm())],
        [
          h.p([], [format(locale, 'photo.deleteQuestion', {})]),
          Deletion.guards.Failed(model.deletion)
            ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'photo.workFailed', {})])
            : h.empty,
          h.div(styled(h, styles.actions()), [
            actionButton(
              {
                label: format(locale, 'photo.delete', {}),
                style: primaryAction(),
                onClick: Message.ClickedConfirmDelete(),
                isDisabled: Deletion.guards.Deleting(model.deletion),
              },
              h,
            ),
            actionButton(
              {
                label: format(locale, 'common.cancel', {}),
                style: linkAction(),
                onClick: Message.ClickedCancelDelete(),
              },
              h,
            ),
          ]),
        ],
      )

const loadedView = (model: Model, photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const { locale } = inputs
  const date = photoDate(photo.createdAt, inputs)
  return [
    h.img([
      h.Src(`/cdn/photos/${photo.id}/full`),
      h.Alt(format(locale, 'photos.open', { date })),
      ...styled(h, styles.photo()),
    ]),
    h.h1(styled(h, styles.title()), [date]),
    actionsView(model, photo, inputs, h),
    deletionView(model, locale, h),
    Work.guards.Failed(model.work)
      ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'photo.workFailed', {})])
      : h.empty,
    photo.status === 'finding'
      ? h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(locale, 'photos.finding', {})])
      : photo.status === 'failed'
        ? h.p([h.Role('status'), ...styled(h, styles.note())], [format(locale, 'photo.findFailed', {})])
        : h.section(
            [h.AriaLabelledBy('photo-garments')],
            [
              h.h2([h.Id('photo-garments')], [format(locale, 'photo.garmentsTitle', {})]),
              h.ul(
                styled(h, styles.garments()),
                photo.garments.map((garment) => garmentRow(model, photo, garment, inputs, h)),
              ),
            ],
          ),
  ]
}

/** One outfit photo of My Gallery. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.photoPage())],
    [
      h.div(styled(h, styles.bar()), [backToGallery(inputs.locale, h)]),
      ...Shown.match(model.shown, {
        Loading: () => [
          h.p(
            [h.Role('status'), ...styled(h, styles.note())],
            [loader(h), format(inputs.locale, 'common.loading', {})],
          ),
        ],
        NotFound: () => [h.p([], [format(inputs.locale, 'photo.notFound', {})])],
        Failed: () => [
          h.p([h.Role('alert')], [format(inputs.locale, 'photos.loadFailed', {})]),
          actionButton(
            {
              label: format(inputs.locale, 'common.tryAgain', {}),
              style: secondaryAction(),
              onClick: Message.ClickedRetry(),
            },
            h,
          ),
        ],
        Loaded: ({ photo }) => loadedView(model, photo, inputs, h),
      }),
    ],
  ),
)
