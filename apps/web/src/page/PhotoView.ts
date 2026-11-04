import { cdn } from '../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import type { Photo, PhotoGarment, Piece } from '@styld/protocol'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, quietLinkAction, secondaryAction } from '../Actions.styles.ts'
import { formError } from '../Fields.styles.ts'
import { favouriteIcon, favouriteOnIcon, loader } from '../Icon.ts'
import { lookRouter, photoRouter, reviewRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { backToGallery } from './PageBar.ts'
import { hasStopped } from '../Polling.ts'
import { retryView } from './Retry.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'
import type { BoardsData, PiecesData } from '../ServerData.ts'
import { piecePickerSheet } from './PiecePickerView.ts'
import { Deletion, Message, type Model, Work } from './Photo.ts'
import { photoDate } from './PhotosView.ts'
import * as styles from './PhotosView.styles.ts'
import { chip, chosen } from '../Controls.styles.ts'
import { pieceLabel } from './WardrobeWords.ts'

interface Inputs {
  readonly locale: Locale
  readonly timeZone: string
  readonly pieces: ReadonlyArray<Piece>
  /** The same pieces as the app holds them, loading or not, for the wardrobe's sheet. */
  readonly wardrobe: PiecesData
  readonly boards: BoardsData
}

const pieceThumb = (piece: Piece, h: HtmlBuilder<Message>): Html =>
  h.img([h.Src(cdn.piece(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.smallThumb())])

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
const matchView = (garment: PhotoGarment, photoId: string, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale, pieces } = inputs
  const piece = Option.fromNullishOr(pieces.find(({ id }) => id === garment.pieceId))
  const named = (found: Piece) =>
    h.span(styled(h, styles.matchPiece()), [pieceThumb(found, h), pieceLabel(found, locale)])
  if (garment.match === 'offered')
    return h.div(styled(h, styles.match()), [
      h.p([], [format(locale, 'photo.offered', {})]),
      h.a(
        [h.Href(reviewRouter({ from: photoRouter({ photoId }) })), ...styled(h, linkAction())],
        [format(locale, 'photo.toReview', {})],
      ),
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

const garmentRow = (model: Model, garment: PhotoGarment, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(garment.id, styled(h, styles.garment()), [
    h.img([h.Src(cdn.photoGarment(garment)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.thumb())]),
    matchView(garment, model.photoId, inputs, h),
  ])

/** The wardrobe's sheet for the garment being matched: every piece, opened on the kind Styld read it as, the piece it
 * is now ticked, then "None of my pieces". */
const pickerView = (model: Model, photo: Photo, { locale, wardrobe }: Inputs, h: HtmlBuilder<Message>): Html =>
  Option.match(
    Option.flatMap(model.choosing, (garmentId) =>
      Option.fromNullishOr(photo.garments.find(({ id }) => id === garmentId)),
    ),
    {
      onNone: () => h.empty,
      onSome: (garment) =>
        piecePickerSheet(
          {
            picker: model.picker,
            pieces: wardrobe,
            locale,
            title: format(locale, 'photo.pick', {}),
            emptyWardrobe: format(locale, 'piecePicker.emptyWardrobe', {}),
            messages: {
              sheet: (message) => Message.GotPiecePickerMessage({ message }),
              group: (group) => Message.SelectedPickerGroup({ group }),
              type: (type) => Message.SelectedPickerType({ type }),
              query: (query) => Message.UpdatedPickerQuery({ query }),
              piece: ({ id }) => Message.ClickedMatch({ garmentId: garment.id, pieceId: id }),
            },
            isChosen: (piece) => garment.match === 'confirmed' && garment.pieceId === piece.id,
            pieceLabel: (name) => name,
            after: [
              h.div(styled(h, styles.actions()), [
                actionButton(
                  {
                    label: format(locale, 'photo.noneOfThese', {}),
                    style: secondaryAction(),
                    onClick: Message.ClickedMatch({ garmentId: garment.id, pieceId: null }),
                  },
                  h,
                ),
              ]),
            ],
          },
          h,
        ),
    },
  )

/** Favourite, Wear it again (or the look it made), and Delete. */
const actionsView = (model: Model, photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const cutting = Work.guards.CuttingOut(model.work)
  const isBusy = cutting || Work.guards.Sending(model.work)
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
              isDisabled: isBusy,
            },
            h,
          )
        : h.empty
      : h.a(
          [h.Href(lookRouter({ lookId: photo.lookId })), ...styled(h, secondaryAction())],
          [format(locale, 'photo.openLook', {})],
        ),
    // Cutting out stays the person's choice (owner, 2026-11-03, T-17): the button says while it works.
    photo.hasCutout
      ? h.empty
      : actionButton(
          {
            label: format(locale, cutting ? 'photo.cuttingOut' : 'photo.cutOut', {}),
            ...(cutting ? { leading: loader(h) } : {}),
            style: secondaryAction(),
            onClick: Message.ClickedCutOut(),
            isDisabled: isBusy,
          },
          h,
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

/** The favourite: a heart over the picture's corner, filled once the photo is one (Eva's review, F-24). */
const favouriteButton = (model: Model, photo: Photo, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(format(locale, 'photos.favourite', {})),
      h.AriaPressed(String(photo.favourite)),
      h.Disabled(Work.guards.Sending(model.work) || Work.guards.CuttingOut(model.work)),
      h.OnClick(Message.ClickedFavourite({ favourite: !photo.favourite })),
      ...styled(h, styles.favourite()),
    ],
    [photo.favourite ? favouriteOnIcon(h) : favouriteIcon(h)],
  )

/** The photo or the person cut out of it, as the page shows; a sideways swipe, or the two names under it once there is
 * a cut-out, chooses (T-17). */
const pictureView = (model: Model, photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const date = photoDate(photo.createdAt, inputs)
  const cutout = model.showing === 'cutout'
  const choice = (showing: 'photo' | 'cutout', label: 'photo.showPhoto' | 'photo.showCutout') =>
    h.button(
      [
        h.Type('button'),
        h.AriaPressed(String(model.showing === showing)),
        h.OnClick(Message.ClickedShow({ showing })),
        ...styled(h, cx(chip(), chosen())),
      ],
      [format(locale, label, {})],
    )
  return h.div(styled(h, styles.pictures()), [
    h.div(
      [
        ...(cutout ? [h.DataAttribute('cutout', '')] : []),
        h.OnPointerDown((_type, _button, screenX, screenY) =>
          Option.some(Message.PressedPicture({ x: screenX, y: screenY })),
        ),
        h.OnPointerUp((screenX, screenY) => Option.some(Message.ReleasedPicture({ x: screenX, y: screenY }))),
        ...styled(h, styles.picture()),
      ],
      [
        h.img([
          h.Src(cutout ? cdn.photoCutout(photo, 'full') : cdn.photo(photo, 'full')),
          h.Alt(format(locale, cutout ? 'photo.cutoutOf' : 'photos.open', { date })),
          h.Draggable(false),
          ...styled(h, styles.photo()),
        ]),
        favouriteButton(model, photo, locale, h),
        Work.guards.CuttingOut(model.work)
          ? h.p([h.Role('status'), ...styled(h, styles.cutting())], [loader(h), format(locale, 'photo.cuttingOut', {})])
          : h.empty,
      ],
    ),
    photo.hasCutout
      ? h.div(
          [h.Role('group'), h.AriaLabel(format(locale, 'photo.pictures', {})), ...styled(h, styles.pictureChoice())],
          [choice('photo', 'photo.showPhoto'), choice('cutout', 'photo.showCutout')],
        )
      : h.empty,
  ])
}

/** What went wrong with the last change, if anything did. */
const workProblem = (work: Model['work']) =>
  Work.match(work, {
    Idle: () => Option.none(),
    Sending: () => Option.none(),
    CuttingOut: () => Option.none(),
    Failed: () => Option.some('photo.workFailed' as const),
    NoPerson: () => Option.some('photo.noPerson' as const),
    SlowDown: () => Option.some('photo.cutOutSlowDown' as const),
  })

const loadedView = (model: Model, photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const { locale } = inputs
  const date = photoDate(photo.createdAt, inputs)
  return [
    pictureView(model, photo, inputs, h),
    h.h1(styled(h, styles.title()), [date]),
    actionsView(model, photo, inputs, h),
    photo.status === 'ready'
      ? h.submodel({
          slotId: 'photo-save-to-board',
          model: model.saveToBoard,
          view: SaveToBoardView.view,
          viewInputs: { locale, boards: inputs.boards },
          toParentMessage: (message) => Message.GotSaveToBoardMessage({ message }),
        })
      : h.empty,
    deletionView(model, locale, h),
    Option.match(workProblem(model.work), {
      onNone: () => h.empty,
      onSome: (problem) => h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, problem, {})]),
    }),
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
                photo.garments.map((garment) => garmentRow(model, garment, inputs, h)),
              ),
              pickerView(model, photo, inputs, h),
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
      ...AsyncData.matchData(model.photo, {
        onEmpty: () => [
          h.p(
            [h.Role('status'), ...styled(h, styles.note())],
            [loader(h), format(inputs.locale, 'common.loading', {})],
          ),
        ],
        onFailure: (error) =>
          error === 'NotFound'
            ? [h.p([], [format(inputs.locale, 'photo.notFound', {})])]
            : [retryView(format(inputs.locale, 'photos.loadFailed', {}), inputs.locale, Message.ClickedRetry(), h)],
        onData: (photo) => [
          ...loadedView(model, photo, inputs, h),
          // Styld was still finding its garments when the polls stopped getting through.
          hasStopped(model.misses)
            ? retryView(format(inputs.locale, 'photos.loadFailed', {}), inputs.locale, Message.ClickedRetry(), h)
            : h.empty,
        ],
      }),
    ],
  ),
)
