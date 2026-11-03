import { cdn } from '../Cdn.ts'
import { textLength, prices } from '@styld/protocol'
import type { Piece, PiecePicture } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { editIcon, loader } from '../Icon.ts'
import { confirmActions } from '../Confirm.ts'
import { styled } from '../Styled.ts'
import { Choosing, Deletion, Message, type Model, type Redraw, RedrawSend, ShowTurn, TurnWork } from './Piece.ts'
import { type Draft, DraftSave } from './PieceDraft.ts'
import { piecePickers } from './PieceFields.ts'
import { kindName, pieceLabel } from './WardrobeWords.ts'
import { backToWardrobe } from './PageBar.ts'
import { hasStopped } from '../Polling.ts'
import { missingPiece, failedPiece } from './PieceStatusView.ts'
import { barEnd, round } from './PageBar.styles.ts'
import { block, line } from '../Skeleton.styles.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import * as styles from './PieceView.styles.ts'
import { factsView } from './PieceFactsView.ts'
import * as PieceBackView from './PieceBackView.ts'
import * as PieceLooksView from './PieceLooksView.ts'
import * as PiecePhotosView from './PiecePhotosView.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'

/** The picture the piece shows; a new drawing, or a change of picture, is a new address. */
const fullPath = (piece: Piece) => cdn.piece(piece, 'full')

/** The piece's back; a new back is a new piece version, so a new address. */
const backPath = cdn.pieceBack

const confirmDelete = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const deleting = Deletion.guards.Deleting(model.deletion)
  return h.section(
    [h.AriaLabelledBy('delete-title'), ...styled(h, styles.confirm())],
    [
      h.h2(
        [h.Id('delete-title'), ...styled(h, styles.confirmTitle())],
        [format(locale, 'wardrobe.deleteItemConfirmTitle', {})],
      ),
      h.p([], [format(locale, 'wardrobe.deletePieceConfirmBody', {})]),
      Deletion.guards.Failed(model.deletion)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.failedDelete', {})])
        : h.empty,
      h.div(
        styled(h, styles.actions()),
        confirmActions(
          {
            confirm: format(locale, deleting ? 'wardrobe.deleting' : 'wardrobe.deleteLabel', {}),
            cancel: format(locale, 'common.cancel', {}),
            onConfirm: Message.ClickedConfirmDelete(),
            onCancel: Message.ClickedCancelDelete(),
            busy: deleting,
          },
          h,
        ),
      ),
    ],
  )
}

/** Where a piece is from: its brand and the shop's link, both optional; a link that is not https says so. */
const shopFields = (draft: Draft, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.label([h.For('piece-brand'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.brandLabel', {})]),
  h.input([
    h.Id('piece-brand'),
    h.Name('brand'),
    h.Type('text'),
    h.Maxlength(textLength.brand),
    h.Autocomplete('off'),
    h.Value(draft.brand),
    h.OnInput((value) => Message.UpdatedBrand({ value })),
    ...styled(h, textField()),
  ]),
  h.label([h.For('piece-shop'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.shopUrlLabel', {})]),
  h.input([
    h.Id('piece-shop'),
    h.Name('shop'),
    h.Type('url'),
    h.InputMode('url'),
    h.Maxlength(textLength.url),
    h.Value(draft.shopUrl),
    h.OnInput((value) => Message.UpdatedShopUrl({ value })),
    ...(draft.shopUrlInvalid ? [h.AriaInvalid(true), h.AriaDescribedBy('piece-shop-problem')] : []),
    ...styled(h, textField()),
  ]),
  draft.shopUrlInvalid
    ? h.p(
        [h.Id('piece-shop-problem'), h.Role('alert'), ...styled(h, formError())],
        [format(locale, 'wardrobe.shopUrlInvalid', {})],
      )
    : h.empty,
]

const editForm = (draft: Draft, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [
      h.OnSubmit(Message.SubmittedEdit()),
      h.AriaBusy(DraftSave.guards.Saving(draft.save)),
      ...styled(h, styles.editForm()),
    ],
    [
      h.label([h.For('piece-name'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.nameLabel', {})]),
      h.input([
        h.Id('piece-name'),
        h.Name('name'),
        h.Type('text'),
        h.Maxlength(textLength.name),
        h.Placeholder(format(locale, 'wardrobe.namePlaceholder', {})),
        h.Value(draft.name),
        h.OnInput((value) => Message.UpdatedName({ value })),
        ...styled(h, textField()),
      ]),
      ...piecePickers(
        { details: draft.details, typeMissing: false, coloursLegend: 'wardrobe.colorsLabel', messages: Message },
        locale,
        h,
      ),
      ...shopFields(draft, locale, h),
      h.label([h.For('piece-notes'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.notesLabel', {})]),
      h.textarea([
        h.Id('piece-notes'),
        h.Name('notes'),
        h.Maxlength(textLength.notes),
        h.Placeholder(format(locale, 'wardrobe.notesPlaceholder', {})),
        h.Value(draft.notes),
        h.OnInput((value) => Message.UpdatedNotes({ value })),
        ...styled(h, styles.notesField()),
      ]),
      DraftSave.guards.Failed(draft.save)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.saveFailed', {})])
        : h.empty,
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.saveAction', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: DraftSave.guards.Saving(draft.save),
            leading: DraftSave.guards.Saving(draft.save) ? loader(h) : h.empty,
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'common.cancel', {}),
            style: secondaryAction(),
            onClick: Message.ClickedCancelEdit(),
            isDisabled: DraftSave.guards.Saving(draft.save),
          },
          h,
        ),
      ]),
    ],
  )

const redrawForm = (redraw: Redraw, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = RedrawSend.guards.Sending(redraw.send)
  return h.form(
    [h.OnSubmit(Message.SubmittedRedraw()), h.AriaBusy(sending), ...styled(h, styles.editForm())],
    [
      h.label([h.For('picture-hint'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.picture.hintLabel', {})]),
      h.input([
        h.Id('picture-hint'),
        h.Name('hint'),
        h.Type('text'),
        h.Maxlength(textLength.hint),
        h.Value(redraw.hint),
        h.Placeholder(format(locale, 'wardrobe.picture.hintPlaceholder', {})),
        h.OnInput((value) => Message.UpdatedHint({ value })),
        ...styled(h, textField()),
      ]),
      h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.picture.redrawCost', { credits: prices.redraw })]),
      RedrawSend.guards.Failed(redraw.send)
        ? h.p(
            [h.Role('alert'), ...styled(h, formError())],
            [format(locale, `wardrobe.picture.problem.${redraw.send.problem}`, {})],
          )
        : h.empty,
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.picture.redraw', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: sending,
            leading: sending ? loader(h) : h.empty,
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'common.cancel', {}),
            style: secondaryAction(),
            onClick: Message.ClickedCancelRedraw(),
            isDisabled: sending,
          },
          h,
        ),
      ]),
    ],
  )
}

/** What the owner can do with the picture it shows: swap it for the other one, take a proposed drawing, redraw. */
const pictureChoices = (picture: PiecePicture, model: Model, locale: Locale, h: HtmlBuilder<Message>) => {
  const choose = (use: 'clean' | 'photo', key: 'wardrobe.picture.showPhoto' | 'wardrobe.picture.showClean') =>
    actionButton(
      {
        label: format(locale, key, {}),
        style: secondaryAction(),
        onClick: Message.ClickedShowPicture({ use }),
        isDisabled: Choosing.guards.Sending(model.choosing),
      },
      h,
    )
  const drawn = picture.state === 'ready' || picture.state === 'proposed'
  return [
    drawn && picture.shows === 'clean' ? choose('photo', 'wardrobe.picture.showPhoto') : h.empty,
    picture.state === 'ready' && picture.shows === 'photo' ? choose('clean', 'wardrobe.picture.showClean') : h.empty,
    actionButton(
      {
        label: format(locale, 'wardrobe.picture.redraw', {}),
        style: secondaryAction(),
        onClick: Message.ClickedRedraw(),
      },
      h,
    ),
  ]
}

/** A proposed drawing beside the photo it would replace, for the owner to take or leave. */
const proposal = (piece: Piece, picture: PiecePicture, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.proposal()), [
    h.img([
      h.Src(cdn.pieceClean(piece)),
      h.Alt(format(locale, 'wardrobe.picture.cleaned', {})),
      ...styled(h, styles.proposalImage()),
    ]),
    h.div(
      [],
      [
        h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.picture.proposed', {})]),
        actionButton(
          {
            label: format(locale, 'wardrobe.picture.use', {}),
            style: primaryAction(),
            onClick: Message.ClickedShowPicture({ use: 'clean' }),
          },
          h,
        ),
      ],
    ),
  ])

const pictureStatus = (picture: PiecePicture, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (picture.state === 'drawing')
    return h.p(
      [h.Role('status'), ...styled(h, styles.status())],
      [loader(h), format(locale, 'wardrobe.picture.drawing', {})],
    )
  if (picture.state === 'retake' || picture.state === 'failed')
    return h.p(styled(h, styles.pictureNote()), [format(locale, `wardrobe.picture.${picture.state}`, {})])
  return picture.shows === 'clean'
    ? h.p(styled(h, styles.cleanedLabel()), [format(locale, 'wardrobe.picture.cleaned', {})])
    : h.empty
}

/** The piece's clean picture: none for a piece that never had one asked for. */
const picturePanel = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const picture = piece.picture
  if (picture === undefined) return h.empty
  return h.section(
    [h.AriaLabel(format(locale, 'wardrobe.picture.cleaned', {})), ...styled(h, styles.picturePanel())],
    [
      pictureStatus(picture, locale, h),
      picture.state === 'proposed' && picture.shows === 'photo' ? proposal(piece, picture, locale, h) : h.empty,
      Choosing.guards.Failed(model.choosing)
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.picture.chooseFailed', {})])
        : h.empty,
      Option.match(model.redraw, {
        onNone: () =>
          picture.state === 'drawing'
            ? h.empty
            : h.div(styled(h, styles.actions()), pictureChoices(picture, model, locale, h)),
        onSome: (redraw) => redrawForm(redraw, locale, h),
      }),
    ],
  )
}

const pieceDetails = (
  piece: Piece,
  model: Model,
  { locale, boards }: SaveToBoardView.ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.details()), [
    h.div(styled(h, styles.titleRow()), [
      h.h1(styled(h, styles.pieceName()), [pieceLabel(piece, locale)]),
      piece.status === 'ready'
        ? h.submodel({
            slotId: 'piece-save-to-board',
            model: model.saveToBoard,
            view: SaveToBoardView.compactView,
            viewInputs: { locale, boards },
            toParentMessage: (message) => Message.GotSaveToBoardMessage({ message }),
          })
        : h.empty,
    ]),
    // What one of its kind is, as its public page says; an unnamed piece's title already says it.
    piece.name === null ? h.empty : h.p(styled(h, styles.meta()), [format(locale, kindName(piece), {})]),
    piece.status === 'processing'
      ? h.p(
          [h.Role('status'), ...styled(h, styles.status())],
          [loader(h), format(locale, 'wardrobe.statusProcessing', {})],
        )
      : h.empty,
    piece.status === 'failed'
      ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.itemProcessFailed', {})])
      : h.empty,
    picturePanel(piece, model, locale, h),
    turnLine(piece, model, locale, h),
    factsView(piece, locale, h),
    h.submodel({
      slotId: 'piece-photos',
      model: model.photos,
      view: PiecePhotosView.view,
      viewInputs: { locale },
      toParentMessage: (message) => Message.GotPhotosMessage({ message }),
    }),
    h.submodel({
      slotId: 'piece-looks',
      model: model.looks,
      view: PieceLooksView.view,
      viewInputs: { locale },
      toParentMessage: (message) => Message.GotLooksMessage({ message }),
    }),
  ])

/** Edit, at the bar's end while the piece is shown and not being edited or deleted (Gallery `item.html` › head). */
const editRound = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  AsyncData.hasData(model.piece) && Option.isNone(model.draft) && Deletion.guards.Idle(model.deletion)
    ? h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'common.edit', {})),
          ...styled(h, cx(round(), barEnd())),
          h.OnClick(Message.ClickedEdit()),
        ],
        [editIcon(h)],
      )
    : h.empty

/** The piece's square and its name in shape while it loads, and what is loading for assistive technology. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.span([h.AriaHidden(true), ...styled(h, cx(block(), styles.photoSkeleton()))]),
  h.div(
    [h.AriaHidden(true), ...styled(h, styles.details())],
    [h.span(styled(h, cx(line(), styles.nameSkeleton()))), h.span(styled(h, cx(line(), styles.metaSkeleton())))],
  ),
  h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
]

/** The piece's picture: its back when that side is chosen, its turn, played on tap, once the clean picture it shows
 * has one ready; else the image. */
const shownPicture = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (piece.hasBack && model.back.side === 'back')
    return h.img([
      h.Src(backPath(piece)),
      h.Alt(format(locale, 'wardrobe.backAlt', { name: pieceLabel(piece, locale) })),
      ...styled(h, styles.photo()),
    ])
  const turn = piece.turn
  const still = (underPlayer: boolean) =>
    h.img([
      h.Src(fullPath(piece)),
      h.Alt(pieceLabel(piece, locale)),
      ...(underPlayer ? [h.AriaHidden(true)] : []),
      ...styled(h, styles.photo()),
    ])
  if (turn?.state !== 'ready' || turn.layout === undefined || piece.picture?.shows !== 'clean') return still(false)
  const sheet = turn.media?.sheet
  if (sheet === undefined) return still(false)
  // The still stays under the player until its sheet has loaded and drawn its first frame.
  return h.div(styled(h, styles.turnStack()), [
    model.turnShown ? h.empty : still(true),
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(format(locale, 'wardrobe.turn.play', {})),
        h.AriaPressed('false'),
        ...styled(h, styles.turnButton()),
      ],
      [
        h.canvas([
          h.Role('img'),
          h.AriaLabel(pieceLabel(piece, locale)),
          h.OnMount(ShowTurn({ sheet, layout: turn.layout })),
          ...styled(h, styles.photo()),
        ]),
      ],
    ),
  ])
}

/** Where the piece's turn stands, and the way to ask for one when its clean picture shows. */
const turnLine = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (piece.picture?.shows !== 'clean') return h.empty
  const turn = piece.turn
  const failed = TurnWork.guards.Failed(model.turnWork) ? Option.some(model.turnWork.problem) : Option.none()
  const problem = Option.match(failed, {
    onNone: () => h.empty,
    onSome: (reason) =>
      h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, `wardrobe.turn.problem.${reason}`, {})]),
  })
  const unbuilt = turn?.state === 'building' && Option.contains(failed, 'build')
  if (unbuilt) return problem
  if (turn?.state === 'making' || turn?.state === 'building' || TurnWork.guards.Building(model.turnWork))
    return h.p(
      [h.Role('status'), ...styled(h, styles.status())],
      [loader(h), format(locale, turn?.state === 'making' ? 'wardrobe.turn.making' : 'wardrobe.turn.building', {})],
    )
  if (turn?.state === 'ready') return h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.turn.ready', {})])
  return h.div(styled(h, styles.picturePanel()), [
    turn?.state === 'failed'
      ? h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.turn.failed', {})])
      : h.empty,
    problem,
    actionButton(
      {
        label: format(locale, 'wardrobe.turn.make', {}),
        style: secondaryAction(),
        onClick: Message.ClickedMakeTurn(),
        isDisabled: TurnWork.guards.Asking(model.turnWork),
        leading: TurnWork.guards.Asking(model.turnWork) ? loader(h) : h.empty,
        describedBy: 'turn-cost',
      },
      h,
    ),
    h.p(
      [h.Id('turn-cost'), ...styled(h, styles.pictureNote())],
      [format(locale, 'wardrobe.turn.cost', { credits: prices.turn })],
    ),
  ])
}

/** The piece's back: Front and Back under the picture, and adding, replacing or removing it. */
const backSlot = (
  slotId: string,
  view: typeof PieceBackView.sides,
  piece: Piece,
  model: Model,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    model: model.back,
    view,
    viewInputs: { piece, locale },
    toParentMessage: (message) => Message.GotBackMessage({ message }),
  })

const loadedView = (
  piece: Piece,
  model: Model,
  inputs: SaveToBoardView.ViewInputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const { locale } = inputs
  return [
    shownPicture(piece, model, locale, h),
    backSlot('piece-sides', PieceBackView.sides, piece, model, locale, h),
    Option.match(model.draft, {
      onNone: () => pieceDetails(piece, model, inputs, h),
      onSome: (draft) =>
        h.div(styled(h, styles.details()), [
          h.h1(styled(h, styles.pieceName()), [pieceLabel(piece, locale)]),
          ...(Deletion.guards.Idle(model.deletion)
            ? [
                backSlot('piece-back', PieceBackView.actions, piece, model, locale, h),
                editForm(draft, locale, h),
                actionButton(
                  {
                    label: format(locale, 'wardrobe.deleteLabel', {}),
                    style: cx(linkAction(), styles.quietDelete()),
                    onClick: Message.ClickedDelete(),
                    isDisabled: DraftSave.guards.Saving(draft.save),
                  },
                  h,
                ),
              ]
            : [confirmDelete(model, locale, h)]),
        ]),
    }),
  ]
}

/** One piece you own: its photo, what it is, its colours and notes (Gallery `item.html`); Save to board lists the
 * person's boards as the app last read them. */
export const view = Submodel.defineView<
  Model,
  Message,
  SaveToBoardView.ViewInputs & { readonly returnTo?: Option.Option<string> }
>((model, inputs, h) => {
  const { locale } = inputs
  return h.main(
    [h.Id('main'), ...styled(h, styles.piecePage())],
    [
      h.div(styled(h, styles.pageBar()), [
        backToWardrobe(locale, h, Option.getOrUndefined(inputs.returnTo ?? Option.none())),
        editRound(model, locale, h),
      ]),
      ...AsyncData.matchData(model.piece, {
        onEmpty: () => loadingView(locale, h),
        onFailure: (error) => [error === 'NotFound' ? missingPiece(locale, h) : failedPiece(locale, h)],
        onData: (piece) => [
          ...loadedView(piece, model, inputs, h),
          hasStopped(model.misses) ? failedPiece(locale, h) : h.empty,
        ],
      }),
    ],
  )
})
