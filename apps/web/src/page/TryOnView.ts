import { Checkbox } from '@foldkit/ui'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Array, Match, Option } from 'effect'
import { cx } from 'zyzz'
import { format, type Locale } from '@styld/i18n'
import { maximumTryOnPieces, prices, type Look, type Photo, type Piece, type TryOn } from '@styld/protocol'
import { cdn } from '../Cdn.ts'
import { confirmActions, Deletion } from '../Confirm.ts'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { chip, chosen } from '../Controls.styles.ts'
import { checkIcon, loader } from '../Icon.ts'
import { photosRouter, tryOnPageRouter, tryOnRouter } from '../route.ts'
import type { BoardsData, PiecesData } from '../ServerData.ts'
import { styled } from '../Styled.ts'
import * as boardStyles from './Board/PageView.styles.ts'
import { spentWords } from './MoreCredits.ts'
import * as pickerStyles from './PiecePickerView.styles.ts'
import { photoDate } from './PhotosView.ts'
import * as photoStyles from './PhotosView.styles.ts'
import { retryView } from './Retry.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'
import { labMain } from './SectionMain.ts'
import { Message, type Model, Problem, Screen, Sending, type Side, tryOnsOf } from './TryOn.ts'
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
type Opened = Extract<Screen, { readonly _tag: 'Open' }>

const photosOf = (model: Model): ReadonlyArray<Photo> =>
  Option.match(AsyncData.getData(model.choices), { onNone: () => [], onSome: ({ photos }) => photos })

const photoById = (model: Model, photoId: string) => Array.findFirst(photosOf(model), ({ id }) => id === photoId)

/** A picture when there is an address for it; nothing is drawn without one. */
const pictureOr = (address: string, picture: (address: string) => Html, h: HtmlBuilder<Message>): Html =>
  address.length > 0 ? picture(address) : h.empty

// LIST

const tileBadge = (tryOn: TryOn, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Match.value(tryOn.status).pipe(
    Match.when('done', () => h.empty),
    Match.whenOr('admitting', 'drawing', () =>
      h.span(styled(h, photoStyles.badge()), [loader(h), format(locale, 'tryOn.making', {})]),
    ),
    Match.whenOr('refused', 'failed', () =>
      h.span(styled(h, photoStyles.badge()), [format(locale, 'tryOn.notDrawn', {})]),
    ),
    Match.exhaustive,
  )

/** A try-on's tile, opening its own page: its picture once drawn, else its photo, with where it stands. */
const tile = (model: Model, tryOn: TryOn, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const maybePhoto = photoById(model, tryOn.photoId)
  const picture =
    cdn.tryOn(tryOn, 'thumb') ||
    Option.match(maybePhoto, { onNone: () => '', onSome: (photo) => cdn.photo(photo, 'thumb') })
  return h.keyed('li')(
    tryOn.id,
    [],
    [
      h.a(
        [
          h.Href(tryOnPageRouter({ tryOnId: tryOn.id })),
          h.AriaLabel(format(locale, 'tryOn.open', { date: photoDate(tryOn.createdAt, inputs) })),
          ...styled(h, cx(photoStyles.tile(), styles.tileButton())),
        ],
        [
          pictureOr(
            picture,
            (address) => h.img([h.Src(address), h.Alt(''), h.Loading('lazy'), ...styled(h, photoStyles.tileImage())]),
            h,
          ),
          tileBadge(tryOn, locale, h),
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
          h.AriaLabel(format(inputs.locale, 'tryOn.choosePhoto', { date: photoDate(photo.createdAt, inputs) })),
          h.AriaPressed(String(Option.contains(screen.maybePhotoId, photo.id))),
          h.OnClick(Message.SelectedPhoto({ photoId: photo.id })),
          ...styled(h, cx(photoStyles.tile(), styles.tileButton())),
        ],
        [
          pictureOr(
            cdn.photo(photo, 'thumb'),
            (address) => h.img([h.Src(address), h.Alt(''), h.Loading('lazy'), ...styled(h, photoStyles.tileImage())]),
            h,
          ),
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
  h.keyed('button')(
    look.id,
    [
      h.Type('button'),
      h.OnClick(Message.SelectedLook({ pieceIds: look.pieces.map(({ id }) => id) })),
      ...styled(h, chip()),
    ],
    [look.name],
  )

const pieceChoice = (screen: Choosing, piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isChosen = screen.pieceIds.includes(piece.id)
  const isFull = !isChosen && screen.pieceIds.length >= maximumTryOnPieces
  const name = pieceDescription(piece, locale)
  return h.keyed('li')(piece.id, styled(h, pickerStyles.tile()), [
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(name),
        h.AriaPressed(String(isChosen)),
        h.Disabled(isFull),
        h.OnClick(Message.ToggledPiece({ pieceId: piece.id })),
        ...styled(h, boardStyles.pick()),
      ],
      [
        pictureOr(
          cdn.piece(piece),
          (address) => h.img([h.Src(address), h.Alt(''), h.Loading('lazy'), ...styled(h, pickerStyles.image())]),
          h,
        ),
        isChosen ? h.span(styled(h, boardStyles.picked()), [checkIcon(h)]) : h.empty,
      ],
    ),
    h.span([h.AriaHidden(true), ...styled(h, pickerStyles.caption())], [name]),
  ])
}

/** The person's ready pieces to choose from, or why there are none to show. */
const piecesView = (screen: Choosing, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return AsyncData.matchData(inputs.pieces, {
    onEmpty: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
    onFailure: () => h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'tryOn.piecesFailed', {})]),
    onData: (pieces) =>
      Array.match(
        Array.filter(pieces, (piece) => piece.status === 'ready'),
        {
          onEmpty: () => h.p(styled(h, styles.note()), [format(locale, 'tryOn.noPieces', {})]),
          onNonEmpty: (ready) =>
            h.ul(
              styled(h, boardStyles.pickGrid()),
              ready.map((piece) => pieceChoice(screen, piece, locale, h)),
            ),
        },
      ),
  })
}

const wearStep = (model: Model, screen: Choosing, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const looks = Option.match(AsyncData.getData(model.choices), {
    onNone: (): ReadonlyArray<Look> => [],
    onSome: (choices) => choices.looks,
  })
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
    piecesView(screen, inputs, h),
  ])
}

/** Why the try-on did not start: today's credits (with the way to more), a refusal, or a lost answer to send again. */
const sendingProblem = (sending: Sending, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Sending.match(sending, {
    Idle: () => h.empty,
    Sending: () => h.empty,
    Failed: ({ problem }) =>
      h.p(
        [h.Role('alert'), ...styled(h, styles.problem())],
        Problem.match(problem, {
          Spent: () => spentWords(format(locale, 'photos.spent', {}), true, locale, h),
          Refused: () => [format(locale, 'tryOn.startRefused', {})],
          Lost: () => [format(locale, 'tryOn.startFailed', {})],
        }),
      ),
  })

const thisIsMeBox = (screen: Choosing, isSending: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Checkbox.view(
    {
      id: 'this-is-me',
      isChecked: screen.thisIsMe,
      isDisabled: isSending,
      hasDescription: true,
      onToggle: (isChecked) => Message.ToggledThisIsMe({ isChecked }),
      toView: (attributes) =>
        h.div(styled(h, styles.consent()), [
          h.div(styled(h, styles.thisIsMe()), [
            h.button([...attributes.checkbox, ...styled(h, styles.box())], [screen.thisIsMe ? checkIcon(h) : h.empty]),
            h.label(attributes.label, [format(locale, 'tryOn.thisIsMe', {})]),
          ]),
          h.p([...attributes.description, ...styled(h, styles.note())], [format(locale, 'tryOn.thisIsMeNote', {})]),
        ]),
    },
    h,
  )

const sendStep = (screen: Choosing, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isSending = Sending.guards.Sending(screen.sending)
  const isReady = Option.isSome(screen.maybePhotoId) && Array.isReadonlyArrayNonEmpty(screen.pieceIds)
  return h.section(styled(h, styles.step()), [
    thisIsMeBox(screen, isSending, locale, h),
    h.div(styled(h, styles.actions()), [
      actionButton(
        {
          label: format(locale, 'tryOn.tryOn', {}),
          style: primaryAction(),
          onClick: Message.ClickedTryOn(),
          isDisabled: isSending || !isReady || !screen.thisIsMe,
          leading: isSending ? loader(h) : h.empty,
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

const sides: ReadonlyArray<Side> = ['before', 'after']
const sideWords = { before: 'tryOn.before', after: 'tryOn.after' } as const

const sideButton = (side: Side, current: Side, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('button')(
    side,
    [
      h.Type('button'),
      h.AriaPressed(String(side === current)),
      h.OnClick(Message.ClickedSide({ side })),
      ...styled(h, cx(chip(), chosen())),
    ],
    [format(locale, sideWords[side], {})],
  )

/** One side of the comparison, captioned; drawn only with its picture's address. */
const figure = (side: Side, address: string, alt: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.figure(
    [h.DataAttribute('side', side), ...styled(h, styles.figure())],
    [
      pictureOr(address, (src) => h.img([h.Src(src), h.Alt(alt), ...styled(h, styles.picture())]), h),
      h.figcaption(styled(h, styles.caption()), [format(locale, sideWords[side], {})]),
    ],
  )

/** The photo and the try-on side by side on a wide screen; on a phone one at a time, Before or After. */
const comparison = (
  tryOn: TryOn,
  maybePhoto: Option.Option<Photo>,
  side: Side,
  locale: Locale,
  h: HtmlBuilder<Message>,
) =>
  h.div(styled(h, styles.compare()), [
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'tryOn.sides', {})), ...styled(h, styles.sides())],
      sides.map((each) => sideButton(each, side, locale, h)),
    ),
    h.div(
      [h.DataAttribute('showing', side), ...styled(h, styles.pair())],
      [
        figure(
          'before',
          Option.match(maybePhoto, { onNone: () => '', onSome: (photo) => cdn.photo(photo, 'full') }),
          format(locale, 'tryOn.beforeAlt', {}),
          locale,
          h,
        ),
        figure('after', cdn.tryOn(tryOn, 'full'), format(locale, 'tryOn.afterAlt', {}), locale, h),
      ],
    ),
  ])

/** The question asked once more before a try-on is deleted, as Gallery's photo asks it; a failure says so beside it. */
const deletionView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Deletion.match(model.deletion, {
    Idle: () =>
      actionButton(
        { label: format(locale, 'tryOn.delete', {}), style: secondaryAction(), onClick: Message.ClickedDelete() },
        h,
      ),
    Confirming: () => deletionQuestion(model, locale, h),
    Deleting: () => deletionQuestion(model, locale, h),
    Failed: () => deletionQuestion(model, locale, h),
  })

const deletionQuestion = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Role('alertdialog'), h.AriaLabel(format(locale, 'tryOn.delete', {})), ...styled(h, styles.step())],
    [
      h.p([], [format(locale, 'tryOn.deleteQuestion', {})]),
      Deletion.guards.Failed(model.deletion)
        ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'tryOn.deleteFailed', {})])
        : h.empty,
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
    ],
  )

const stoppedView = (model: Model, tryOn: TryOn, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
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

const drawnView = (model: Model, screen: Opened, tryOn: TryOn, inputs: Inputs, h: HtmlBuilder<Message>) => [
  comparison(tryOn, photoById(model, tryOn.photoId), screen.side, inputs.locale, h),
  h.div(styled(h, styles.actions()), [
    h.submodel({
      slotId: 'try-on-save-to-board',
      model: screen.saveToBoard,
      view: SaveToBoardView.view,
      viewInputs: { locale: inputs.locale, boards: inputs.boards },
      toParentMessage: (message) => Message.GotSaveToBoardMessage({ message }),
    }),
    deletionView(model, inputs.locale, h),
  ]),
]

const statusView = (model: Model, screen: Opened, tryOn: TryOn, inputs: Inputs, h: HtmlBuilder<Message>) =>
  Match.value(tryOn.status).pipe(
    Match.withReturnType<ReadonlyArray<Html>>(),
    Match.whenOr('admitting', 'drawing', () => [
      h.p([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(inputs.locale, 'tryOn.drawing', {})]),
    ]),
    Match.whenOr('refused', 'failed', () => stoppedView(model, tryOn, inputs.locale, h)),
    Match.when('done', () => drawnView(model, screen, tryOn, inputs, h)),
    Match.exhaustive,
  )

const openView = (model: Model, screen: Opened, inputs: Inputs, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.div(
    [],
    [h.a([h.Href(tryOnRouter({})), ...styled(h, secondaryAction())], [format(inputs.locale, 'tryOn.back', {})])],
  ),
  ...Option.match(
    Array.findFirst(tryOnsOf(model), ({ id }) => id === screen.tryOnId),
    {
      onNone: () =>
        AsyncData.matchData(model.tryOns, {
          onEmpty: () => [h.p([h.Role('status')], [format(inputs.locale, 'common.loading', {})])],
          onFailure: () => [
            retryView(format(inputs.locale, 'tryOn.loadFailed', {}), inputs.locale, Message.ClickedRetry(), h),
          ],
          onData: () => [h.p([h.Role('status')], [format(inputs.locale, 'tryOn.gone', {})])],
        }),
      onSome: (tryOn) => statusView(model, screen, tryOn, inputs, h),
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
      Open: (screen) => openView(model, screen, inputs, h),
    }),
    inputs.locale,
    h,
  ),
)
