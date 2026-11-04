import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Array, Option } from 'effect'
import { cx } from 'zyzz'
import { format, type Locale } from '@styld/i18n'
import { maximumTryOnPieces, prices, type Look, type Photo, type Piece, type TryOn } from '@styld/protocol'
import { cdn } from '../Cdn.ts'
import { confirmActions, Deletion } from '../Confirm.ts'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { chip, chosen } from '../Controls.styles.ts'
import { checkIcon, loader } from '../Icon.ts'
import { photosRouter } from '../route.ts'
import type { BoardsData, PiecesData } from '../ServerData.ts'
import { styled } from '../Styled.ts'
import * as boardStyles from './Board/PageView.styles.ts'
import * as pickerStyles from './PiecePickerView.styles.ts'
import { photoDate } from './PhotosView.ts'
import * as photoStyles from './PhotosView.styles.ts'
import { retryView } from './Retry.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'
import { labMain } from './SectionMain.ts'
import { isMaking, Message, type Model, Screen, Sending, tryOnsOf } from './TryOn.ts'
import * as styles from './TryOnView.styles.ts'
import { pieceDescription } from './WardrobeWords.ts'
import { message as messageSection, messageTitle } from './WardrobeView.styles.ts'

interface Inputs {
  readonly locale: Locale
  readonly timeZone: string
  readonly pieces: PiecesData
  readonly boards: BoardsData
}

type Choosing = Extract<Screen, { readonly _tag: 'New' }>

const photosOf = (model: Model): ReadonlyArray<Photo> =>
  Option.match(AsyncData.getData(model.choices), { onNone: () => [], onSome: ({ photos }) => photos })

const photoById = (model: Model, photoId: string) => Array.findFirst(photosOf(model), ({ id }) => id === photoId)

// LIST

/** A try-on's tile: its picture once drawn, else its photo with where it stands. */
const tile = (model: Model, tryOn: TryOn, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const photo = photoById(model, tryOn.photoId)
  const picture =
    tryOn.images?.thumb ?? Option.match(photo, { onNone: () => '', onSome: (shown) => cdn.photo(shown, 'thumb') })
  return h.keyed('li')(
    tryOn.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'tryOn.open', { date: photoDate(tryOn.createdAt, inputs) })),
          h.OnClick(Message.ClickedOpen({ tryOnId: tryOn.id })),
          ...styled(h, cx(photoStyles.tile(), styles.tileButton())),
        ],
        [
          h.img([h.Src(picture), h.Alt(''), h.Loading('lazy'), ...styled(h, photoStyles.tileImage())]),
          isMaking(tryOn)
            ? h.span(styled(h, photoStyles.badge()), [loader(h), format(locale, 'tryOn.making', {})])
            : tryOn.status === 'done'
              ? h.empty
              : h.span(styled(h, photoStyles.badge()), [format(locale, 'tryOn.notDrawn', {})]),
        ],
      ),
    ],
  )
}

const newAction = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  actionButton({ label: format(locale, 'tryOn.new', {}), style: primaryAction(), onClick: Message.ClickedNew() }, h)

const listView = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const { locale } = inputs
  return AsyncData.matchData(model.tryOns, {
    onEmpty: () => [h.p([h.Role('status')], [format(locale, 'common.loading', {})])],
    onFailure: () => [retryView(format(locale, 'tryOn.loadFailed', {}), locale, Message.ClickedRetry(), h)],
    onData: (tryOns) =>
      Array.match(tryOns, {
        onEmpty: () => [
          h.section(styled(h, messageSection()), [
            h.h2(styled(h, messageTitle()), [format(locale, 'tryOn.emptyTitle', {})]),
            h.p([], [format(locale, 'tryOn.emptyHint', {})]),
            h.div([], [newAction(locale, h)]),
          ]),
        ],
        onNonEmpty: (shown) => [
          h.ul(
            styled(h, photoStyles.grid()),
            shown.map((tryOn) => tile(model, tryOn, inputs, h)),
          ),
        ],
      }),
  })
}

// NEW

const photoChoice = (screen: Choosing, photo: Photo, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    photo.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(inputs.locale, 'photos.open', { date: photoDate(photo.createdAt, inputs) })),
          h.AriaPressed(String(Option.contains(screen.maybePhotoId, photo.id))),
          h.OnClick(Message.SelectedPhoto({ photoId: photo.id })),
          ...styled(h, cx(photoStyles.tile(), styles.tileButton())),
        ],
        [
          h.img([
            h.Src(cdn.photo(photo, 'thumb')),
            h.Alt(''),
            h.Loading('lazy'),
            ...styled(h, photoStyles.tileImage()),
          ]),
        ],
      ),
    ],
  )

const photoStep = (model: Model, screen: Choosing, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return h.section(styled(h, styles.step()), [
    h.h2(styled(h, styles.stepTitle()), [format(locale, 'tryOn.photoTitle', {})]),
    AsyncData.matchData(model.choices, {
      onEmpty: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
      onFailure: () => retryView(format(locale, 'photos.loadFailed', {}), locale, Message.ClickedRetry(), h),
      onData: ({ photos }) =>
        Array.match(photos, {
          onEmpty: () =>
            h.p(styled(h, styles.note()), [
              format(locale, 'tryOn.noPhotos', {}),
              ' ',
              h.a([h.Href(photosRouter({}))], [format(locale, 'tryOn.openGallery', {})]),
            ]),
          onNonEmpty: (shown) =>
            h.ul(
              styled(h, styles.photoGrid()),
              shown.map((photo) => photoChoice(screen, photo, inputs, h)),
            ),
        }),
    }),
  ])
}

const lookChoice = (look: Look, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.OnClick(Message.SelectedLook({ pieceIds: look.pieces.map(({ id }) => id) })),
      ...styled(h, chip()),
    ],
    [look.name],
  )

const pieceChoice = (screen: Choosing, piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isChosen = screen.pieceIds.includes(piece.id)
  const name = pieceDescription(piece, locale)
  return h.keyed('li')(piece.id, styled(h, pickerStyles.tile()), [
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(name),
        h.AriaPressed(String(isChosen)),
        h.OnClick(Message.ToggledPiece({ pieceId: piece.id })),
        ...styled(h, boardStyles.pick()),
      ],
      [
        h.img([h.Src(cdn.piece(piece)), h.Alt(''), h.Loading('lazy'), ...styled(h, pickerStyles.image())]),
        isChosen ? h.span(styled(h, boardStyles.picked()), [checkIcon(h)]) : h.empty,
      ],
    ),
    h.span([h.AriaHidden(true), ...styled(h, pickerStyles.caption())], [name]),
  ])
}

const wearStep = (model: Model, screen: Choosing, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const looks = Option.match(AsyncData.getData(model.choices), {
    onNone: (): ReadonlyArray<Look> => [],
    onSome: (choices) => choices.looks,
  })
  const ready = Option.getOrElse(AsyncData.getData(inputs.pieces), (): ReadonlyArray<Piece> => []).filter(
    (piece) => piece.status === 'ready',
  )
  return h.section(styled(h, styles.step()), [
    h.h2(styled(h, styles.stepTitle()), [format(locale, 'tryOn.wearTitle', {})]),
    Array.isReadonlyArrayEmpty(looks)
      ? h.empty
      : h.div(
          [h.Role('group'), h.AriaLabel(format(locale, 'tryOn.fromLook', {})), ...styled(h, styles.looks())],
          looks.map((look) => lookChoice(look, h)),
        ),
    h.p(
      [h.AriaLive('polite'), ...styled(h, styles.note())],
      [format(locale, 'tryOn.chosen', { count: screen.pieceIds.length, most: maximumTryOnPieces })],
    ),
    h.ul(
      styled(h, boardStyles.pickGrid()),
      ready.map((piece) => pieceChoice(screen, piece, locale, h)),
    ),
  ])
}

const sendingProblem = (sending: Sending, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Sending.guards.Failed(sending)
    ? h.p(
        [h.Role('alert'), ...styled(h, styles.problem())],
        [format(locale, sending.spent ? 'photos.spent' : 'tryOn.startFailed', {})],
      )
    : h.empty

const sendStep = (screen: Choosing, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Sending.guards.Sending(screen.sending)
  const ready = Option.isSome(screen.maybePhotoId) && Array.isReadonlyArrayNonEmpty(screen.pieceIds)
  return h.section(styled(h, styles.step()), [
    h.label(
      [h.For('this-is-me'), ...styled(h, styles.thisIsMe())],
      [
        h.input([
          h.Id('this-is-me'),
          h.Type('checkbox'),
          h.Checked(screen.thisIsMe),
          h.AriaDescribedBy('try-on-sent'),
          h.OnClick(Message.ToggledThisIsMe()),
        ]),
        format(locale, 'tryOn.thisIsMe', {}),
      ],
    ),
    h.p([h.Id('try-on-sent'), ...styled(h, styles.note())], [format(locale, 'tryOn.thisIsMeNote', {})]),
    h.div(styled(h, styles.actions()), [
      actionButton(
        {
          label: format(locale, 'tryOn.tryOn', {}),
          style: primaryAction(),
          onClick: Message.ClickedTryOn(),
          isDisabled: sending || !ready || !screen.thisIsMe,
          leading: sending ? loader(h) : h.empty,
          describedBy: 'try-on-cost',
        },
        h,
      ),
      actionButton(
        { label: format(locale, 'common.cancel', {}), style: secondaryAction(), onClick: Message.ClickedBack() },
        h,
      ),
    ]),
    h.p([h.Id('try-on-cost'), ...styled(h, styles.note())], [format(locale, 'tryOn.cost', { credits: prices.tryOn })]),
    sendingProblem(screen.sending, locale, h),
  ])
}

const newView = (model: Model, screen: Choosing, inputs: Inputs, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  photoStep(model, screen, inputs, h),
  wearStep(model, screen, inputs, h),
  sendStep(screen, inputs.locale, h),
]

// OPEN

const sideButton = (side: 'before' | 'after', current: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(String(side === current)),
      h.OnClick(Message.ClickedSide({ side })),
      ...styled(h, cx(chip(), chosen())),
    ],
    [format(locale, side === 'before' ? 'tryOn.before' : 'tryOn.after', {})],
  )

/** The photo and the try-on side by side on a wide screen; on a phone one at a time, Before or After. */
const comparison = (tryOn: TryOn, photo: Option.Option<Photo>, side: string, locale: Locale, h: HtmlBuilder<Message>) =>
  h.div(styled(h, styles.compare()), [
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'tryOn.title', {})), ...styled(h, styles.sides())],
      [sideButton('before', side, locale, h), sideButton('after', side, locale, h)],
    ),
    h.div(
      [h.DataAttribute('showing', side), ...styled(h, styles.pair())],
      [
        h.figure(
          [h.DataAttribute('side', 'before'), ...styled(h, styles.figure())],
          [
            h.img([
              h.Src(Option.match(photo, { onNone: () => '', onSome: (shown) => cdn.photo(shown, 'full') })),
              h.Alt(format(locale, 'tryOn.beforeAlt', {})),
              ...styled(h, styles.picture()),
            ]),
          ],
        ),
        h.figure(
          [h.DataAttribute('side', 'after'), ...styled(h, styles.figure())],
          [
            h.img([
              h.Src(tryOn.images?.full ?? ''),
              h.Alt(format(locale, 'tryOn.afterAlt', {})),
              ...styled(h, styles.picture()),
            ]),
          ],
        ),
      ],
    ),
  ])

const deletionView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Deletion.guards.Idle(model.deletion)
    ? actionButton(
        { label: format(locale, 'tryOn.delete', {}), style: secondaryAction(), onClick: Message.ClickedDelete() },
        h,
      )
    : h.div(styled(h, styles.step()), [
        h.p(
          [h.Role('alert')],
          [format(locale, Deletion.guards.Failed(model.deletion) ? 'tryOn.deleteFailed' : 'tryOn.deleteQuestion', {})],
        ),
        h.div(
          styled(h, styles.actions()),
          confirmActions(
            {
              confirm: format(locale, 'tryOn.delete', {}),
              cancel: format(locale, 'common.cancel', {}),
              onConfirm: Message.ClickedConfirmDelete(),
              onCancel: Message.ClickedCancelDelete(),
              busy: Deletion.guards.Deleting(model.deletion),
            },
            h,
          ),
        ),
      ])

const statusView = (
  model: Model,
  tryOn: TryOn,
  photo: Option.Option<Photo>,
  side: string,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const { locale } = inputs
  if (isMaking(tryOn))
    return [h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(locale, 'tryOn.drawing', {})])]
  if (tryOn.status !== 'done')
    return [
      h.p([h.Role('alert')], [format(locale, tryOn.status === 'refused' ? 'tryOn.refused' : 'tryOn.failed', {})]),
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'common.tryAgain', {}),
            style: primaryAction(),
            onClick: Message.ClickedTryAgain({ photoId: tryOn.photoId, pieceIds: tryOn.pieceIds }),
          },
          h,
        ),
        deletionView(model, locale, h),
      ]),
    ]
  return [
    comparison(tryOn, photo, side, locale, h),
    h.div(styled(h, styles.actions()), [
      h.submodel({
        slotId: 'try-on-save-to-board',
        model: model.saveToBoard,
        view: SaveToBoardView.view,
        viewInputs: { locale, boards: inputs.boards },
        toParentMessage: (message) => Message.GotSaveToBoardMessage({ message }),
      }),
      deletionView(model, locale, h),
    ]),
  ]
}

const openView = (
  model: Model,
  tryOnId: string,
  side: string,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.div(
    [],
    [
      actionButton(
        { label: format(inputs.locale, 'tryOn.back', {}), style: secondaryAction(), onClick: Message.ClickedBack() },
        h,
      ),
    ],
  ),
  ...Option.match(
    Array.findFirst(tryOnsOf(model), ({ id }) => id === tryOnId),
    {
      onNone: () => [h.p([h.Role('status')], [format(inputs.locale, 'common.loading', {})])],
      onSome: (tryOn) => statusView(model, tryOn, photoById(model, tryOn.photoId), side, inputs, h),
    },
  ),
]

/** Try on: the person's try-ons, a new one, or one beside its photo. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  labMain(
    'tryOn',
    styles.page(),
    Screen.guards.List(model.screen) && Option.exists(AsyncData.getData(model.tryOns), Array.isReadonlyArrayNonEmpty)
      ? Option.some(newAction(inputs.locale, h))
      : Option.none(),
    Screen.match(model.screen, {
      List: () => listView(model, inputs, h),
      New: (screen) => newView(model, screen, inputs, h),
      Open: ({ tryOnId, side }) => openView(model, tryOnId, side, inputs, h),
    }),
    inputs.locale,
    h,
  ),
)
