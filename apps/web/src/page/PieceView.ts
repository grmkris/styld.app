import type { Piece, PiecePicture } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { editIcon, loader } from '../Icon.ts'
import { wardrobeRouter } from '../route.ts'
import { confirmActions } from '../ConfirmActions.ts'
import { styled } from '../Styled.ts'
import { Deletion, type Draft, Load, Message, type Model, type Redraw, ShowTurn } from './Piece.ts'
import { colourList, piecePickers } from './PieceFields.ts'
import { categoryName, pieceLabel, subcategoryName } from './WardrobeWords.ts'
import { backToWardrobe } from './PageBar.ts'
import { round } from './PageBar.styles.ts'
import { block, line } from '../Skeleton.styles.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import * as styles from './PieceView.styles.ts'
import * as SaveToBoardView from './SaveToBoardView.ts'

/** The picture the piece shows; a new drawing, or a change of picture, is a new address. */
const fullPath = (piece: Piece) =>
  `/cdn/pieces/${piece.id}/full${piece.picture === undefined ? '' : `?v=${piece.picture.shows}${piece.picture.version}`}`

const whatItIs = (piece: Piece, locale: Locale) =>
  [categoryName(piece.category), ...(piece.subcategory === null ? [] : [subcategoryName(piece.subcategory)])]
    .map((key) => format(locale, key, {}))
    .join(', ')

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

const editForm = (draft: Draft, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.OnSubmit(Message.SubmittedEdit()), h.AriaBusy(draft.saving), ...styled(h, styles.editForm())],
    [
      h.label([h.For('piece-name'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.nameLabel', {})]),
      h.input([
        h.Id('piece-name'),
        h.Name('name'),
        h.Type('text'),
        h.Maxlength(80),
        h.Value(draft.name),
        h.OnInput((value) => Message.UpdatedName({ value })),
        ...styled(h, textField()),
      ]),
      ...piecePickers(
        {
          category: Option.some(draft.category),
          categoryMissing: false,
          subcategory: draft.subcategory,
          colours: draft.colours,
          coloursLegend: 'wardrobe.colorsLabel',
          messages: Message,
        },
        locale,
        h,
      ),
      h.label([h.For('piece-notes'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.notesLabel', {})]),
      h.textarea([
        h.Id('piece-notes'),
        h.Name('notes'),
        h.Maxlength(500),
        h.Placeholder(format(locale, 'wardrobe.notesPlaceholder', {})),
        h.Value(draft.notes),
        h.OnInput((value) => Message.UpdatedNotes({ value })),
        ...styled(h, styles.notesField()),
      ]),
      draft.failed
        ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.saveFailed', {})])
        : h.empty,
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.saveAction', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: draft.saving,
            leading: draft.saving ? loader(h) : h.empty,
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'common.cancel', {}),
            style: secondaryAction(),
            onClick: Message.ClickedCancelEdit(),
            isDisabled: draft.saving,
          },
          h,
        ),
      ]),
    ],
  )

const redrawForm = (redraw: Redraw, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.OnSubmit(Message.SubmittedRedraw()), h.AriaBusy(redraw.sending), ...styled(h, styles.editForm())],
    [
      h.label([h.For('picture-hint'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.picture.hintLabel', {})]),
      h.input([
        h.Id('picture-hint'),
        h.Name('hint'),
        h.Type('text'),
        h.Maxlength(80),
        h.Value(redraw.hint),
        h.Placeholder(format(locale, 'wardrobe.picture.hintPlaceholder', {})),
        h.OnInput((value) => Message.UpdatedHint({ value })),
        ...styled(h, textField()),
      ]),
      h.p(styled(h, styles.pictureNote()), [format(locale, 'wardrobe.picture.redrawCost', {})]),
      Option.match(redraw.problem, {
        onNone: () => h.empty,
        onSome: (problem) =>
          h.p(
            [h.Role('alert'), ...styled(h, formError())],
            [format(locale, `wardrobe.picture.problem.${problem}`, {})],
          ),
      }),
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, 'wardrobe.picture.redraw', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: redraw.sending,
            leading: redraw.sending ? loader(h) : h.empty,
          },
          h,
        ),
        actionButton(
          {
            label: format(locale, 'common.cancel', {}),
            style: secondaryAction(),
            onClick: Message.ClickedCancelRedraw(),
            isDisabled: redraw.sending,
          },
          h,
        ),
      ]),
    ],
  )

/** What the owner can do with the picture it shows: swap it for the other one, take a proposed drawing, redraw. */
const pictureChoices = (picture: PiecePicture, model: Model, locale: Locale, h: HtmlBuilder<Message>) => {
  const choose = (use: 'clean' | 'photo', key: 'wardrobe.picture.showPhoto' | 'wardrobe.picture.showClean') =>
    actionButton(
      {
        label: format(locale, key, {}),
        style: secondaryAction(),
        onClick: Message.ClickedShowPicture({ use }),
        isDisabled: model.choosing === 'sending',
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
      h.Src(`/cdn/pieces/${piece.id}/clean/thumb?v=${picture.version}`),
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
      model.choosing === 'failed'
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

const pieceDetails = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.details()), [
    h.h1(styled(h, styles.pieceName()), [pieceLabel(piece, locale)]),
    h.p(styled(h, styles.meta()), [whatItIs(piece, locale)]),
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
    piece.status === 'ready'
      ? h.submodel({
          slotId: 'piece-save-to-board',
          model: model.saveToBoard,
          view: SaveToBoardView.view,
          viewInputs: { locale },
          toParentMessage: (message) => Message.GotSaveToBoardMessage({ message }),
        })
      : h.empty,
    factsView(piece, locale, h),
    // Save to board is the page's one action; Delete is quiet, at the end, and asks first.
    Deletion.guards.Idle(model.deletion)
      ? actionButton(
          {
            label: format(locale, 'wardrobe.deleteLabel', {}),
            style: cx(linkAction(), styles.quietDelete()),
            onClick: Message.ClickedDelete(),
          },
          h,
        )
      : confirmDelete(model, locale, h),
  ])

/** What the piece is, row by row (Gallery `item.html` › facts): its colours, named, and the person's notes. */
const factsView = (piece: Piece, locale: Locale, h: HtmlBuilder<Message>): Html =>
  piece.colours.length === 0 && piece.notes === null
    ? h.empty
    : h.dl(styled(h, styles.facts()), [
        piece.colours.length === 0
          ? h.empty
          : h.div(styled(h, styles.fact()), [
              h.dt(styled(h, styles.factTerm()), [format(locale, 'wardrobe.colorsLabel', {})]),
              h.dd(styled(h, styles.factValue()), [colourList(piece.colours, locale, h)]),
            ]),
        piece.notes === null
          ? h.empty
          : h.div(styled(h, styles.fact()), [
              h.dt(styled(h, styles.factTerm()), [format(locale, 'wardrobe.notesLabel', {})]),
              h.dd(styled(h, styles.factValue()), [piece.notes]),
            ]),
      ])

/** Edit, at the bar's end while the piece is shown and not being edited or deleted (Gallery `item.html` › head). */
const editRound = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Load.guards.Loaded(model.load) && Option.isNone(model.draft) && Deletion.guards.Idle(model.deletion)
    ? h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'common.edit', {})),
          ...styled(h, round()),
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

/** The piece's picture: its turn, played on tap, once the clean picture it shows has one ready; else the image. */
const shownPicture = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const turn = piece.turn
  const still = (underPlayer: boolean) =>
    h.img([
      h.Src(fullPath(piece)),
      h.Alt(pieceLabel(piece, locale)),
      ...(underPlayer ? [h.AriaHidden(true)] : []),
      ...styled(h, styles.photo()),
    ])
  if (turn?.state !== 'ready' || turn.layout === undefined || piece.picture?.shows !== 'clean') return still(false)
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
          h.OnMount(ShowTurn({ pieceId: piece.id, version: turn.version, layout: turn.layout })),
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
  const problem = Option.match(model.turnProblem, {
    onNone: () => h.empty,
    onSome: (reason) =>
      h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, `wardrobe.turn.problem.${reason}`, {})]),
  })
  const unbuilt = turn?.state === 'building' && Option.contains(model.turnProblem, 'build')
  if (unbuilt) return problem
  if (turn?.state === 'making' || turn?.state === 'building' || model.turnWork === 'building')
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
        isDisabled: model.turnWork === 'asking',
        leading: model.turnWork === 'asking' ? loader(h) : h.empty,
        describedBy: 'turn-cost',
      },
      h,
    ),
    h.p([h.Id('turn-cost'), ...styled(h, styles.pictureNote())], [format(locale, 'wardrobe.turn.cost', {})]),
  ])
}

const loadedView = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  shownPicture(piece, model, locale, h),
  Option.match(model.draft, {
    onNone: () => pieceDetails(piece, model, locale, h),
    onSome: (draft) =>
      h.div(styled(h, styles.details()), [
        h.h1(styled(h, styles.pieceName()), [pieceLabel(piece, locale)]),
        editForm(draft, locale, h),
      ]),
  }),
]

const notice = (
  locale: Locale,
  h: HtmlBuilder<Message>,
  key: 'wardrobe.itemNotFound' | 'wardrobe.shelves.loadFailed',
) =>
  h.div(styled(h, styles.details()), [
    h.p([h.Role('alert')], [format(locale, key, {})]),
    key === 'wardrobe.shelves.loadFailed'
      ? actionButton(
          {
            label: format(locale, 'wardrobe.shelves.retry', {}),
            style: primaryAction(),
            onClick: Message.ClickedRetry(),
          },
          h,
        )
      : h.a(
          [h.Href(wardrobeRouter({})), ...styled(h, secondaryAction())],
          [format(locale, 'wardrobe.backToWardrobe', {})],
        ),
  ])

/** One piece you own: its photo, what it is, its colours and notes (Gallery `item.html`). */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.piecePage())],
    [
      h.div(styled(h, styles.pageBar()), [backToWardrobe(locale, h), editRound(model, locale, h)]),
      ...Load.match(model.load, {
        Loading: () => loadingView(locale, h),
        Loaded: ({ piece }) => loadedView(piece, model, locale, h),
        Missing: () => [notice(locale, h, 'wardrobe.itemNotFound')],
        Failed: () => [notice(locale, h, 'wardrobe.shelves.loadFailed')],
      }),
    ],
  ),
)
