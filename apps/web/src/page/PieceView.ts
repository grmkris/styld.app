import type { Piece } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { deleteIcon, editIcon, loader } from '../Icon.ts'
import { wardrobeRouter } from '../route.ts'
import { confirmActions } from '../ConfirmActions.ts'
import { styled } from '../Styled.ts'
import { Deletion, type Draft, Load, Message, type Model } from './Piece.ts'
import { piecePickers, swatches } from './PieceFields.ts'
import { pieceLabel } from './WardrobeView.ts'
import { categoryName, subcategoryName } from './WardrobeWords.ts'
import { backToWardrobe } from './PageBar.ts'
import * as styles from './PieceView.styles.ts'

const fullPath = (piece: Piece) => `/cdn/pieces/${piece.id}/full`

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
    piece.colours.length > 0 ? swatches(piece.colours, locale, h) : h.empty,
    Deletion.guards.Idle(model.deletion)
      ? h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'common.edit', {}),
              style: secondaryAction(),
              onClick: Message.ClickedEdit(),
              leading: editIcon(h),
            },
            h,
          ),
          actionButton(
            {
              label: format(locale, 'wardrobe.deleteLabel', {}),
              style: secondaryAction(),
              onClick: Message.ClickedDelete(),
              leading: deleteIcon(h),
            },
            h,
          ),
        ])
      : confirmDelete(model, locale, h),
    piece.notes === null
      ? h.empty
      : h.dl(styled(h, styles.facts()), [
          h.div(styled(h, styles.fact()), [
            h.dt(styled(h, styles.factTerm()), [format(locale, 'wardrobe.notesLabel', {})]),
            h.dd(styled(h, styles.factValue()), [piece.notes]),
          ]),
        ]),
  ])

const loadedView = (piece: Piece, model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.img([h.Src(fullPath(piece)), h.Alt(pieceLabel(piece, locale)), ...styled(h, styles.photo())]),
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
      h.div(styled(h, styles.pageBar()), [backToWardrobe(locale, h)]),
      ...Load.match(model.load, {
        Loading: () => [
          h.p([h.Role('status'), ...styled(h, styles.status())], [loader(h), format(locale, 'common.loading', {})]),
        ],
        Loaded: ({ piece }) => loadedView(piece, model, locale, h),
        Missing: () => [notice(locale, h, 'wardrobe.itemNotFound')],
        Failed: () => [notice(locale, h, 'wardrobe.shelves.loadFailed')],
      }),
    ],
  ),
)
