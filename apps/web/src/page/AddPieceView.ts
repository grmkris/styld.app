import { FileDrop } from '@foldkit/ui'
import { ImageType } from '@styld/protocol'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { fieldLabel, formError, textField } from '../Fields.styles.ts'
import { backIcon, loader, photoIcon } from '../Icon.ts'
import { wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { Message, type Model, type PhotoProblem, Submission } from './AddPiece.ts'
import { piecePickers } from './PieceFields.ts'
import * as styles from './AddPieceView.styles.ts'

const photoProblemKey: { readonly [Key in PhotoProblem]: MessageKey } = {
  missing: 'wardrobe.addPieceNeedsPhoto',
  notAnImage: 'wardrobe.addPieceUnsupportedPhoto',
  tooLarge: 'wardrobe.fileTooLarge',
}

const photoProblemId = 'piece-photo-problem'

const dropZone = (model: Model, locale: Locale, h: HtmlBuilder<Message>, chosen: boolean): Html =>
  h.submodel({
    slotId: model.drop.id,
    model: model.drop,
    view: FileDrop.view,
    viewInputs: {
      accept: ImageType.literals,
      toView: (attributes) =>
        chosen
          ? h.label(
              [...attributes.root, ...styled(h, styles.changePhoto())],
              [format(locale, 'wardrobe.addPieceChangePhoto', {}), h.input(attributes.input)],
            )
          : h.label(
              [
                ...attributes.root,
                h.AriaInvalid(Option.isSome(model.photoProblem)),
                ...(Option.isSome(model.photoProblem) ? [h.AriaDescribedBy(photoProblemId)] : []),
                ...styled(h, styles.dropZone()),
              ],
              [
                photoIcon(h),
                h.span(styled(h, styles.dropTitle()), [format(locale, 'wardrobe.addPiecePickPhoto', {})]),
                h.input(attributes.input),
              ],
            ),
    },
    toParentMessage: (message) => Message.GotDropMessage({ message }),
  })

const photoSection = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      Option.match(model.photo, {
        onNone: () => dropZone(model, locale, h, false),
        onSome: () =>
          h.div(styled(h, styles.addPage()), [
            Option.match(model.preview, {
              onNone: () => h.empty,
              onSome: (url) =>
                h.img([
                  h.Src(url),
                  h.Alt(format(locale, 'wardrobe.uploadedItemAlt', {})),
                  ...styled(h, styles.preview()),
                ]),
            }),
            h.div(styled(h, styles.photoActions()), [
              dropZone(model, locale, h, true),
              actionButton(
                {
                  label: format(locale, 'wardrobe.removeUpload', {}),
                  style: secondaryAction(),
                  onClick: Message.ClickedRemovePhoto(),
                },
                h,
              ),
            ]),
          ]),
      }),
      Option.match(model.photoProblem, {
        onNone: () => h.empty,
        onSome: (problem) =>
          h.p(
            [h.Id(photoProblemId), h.Role('alert'), ...styled(h, formError())],
            [format(locale, photoProblemKey[problem], {})],
          ),
      }),
    ],
  )

const busyLabel = (model: Model): MessageKey =>
  Submission.match(model.submission, {
    Idle: (): MessageKey => 'wardrobe.addPieceSubmit',
    Failed: (): MessageKey => 'wardrobe.addPieceSubmit',
    Preparing: (): MessageKey => 'wardrobe.uploadingImage',
    Uploading: (): MessageKey => 'wardrobe.uploadingImage',
    Adding: (): MessageKey => 'wardrobe.addingPieces',
  })

/** What the piece is: the pickers, then an optional name. */
const pieceFields = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  ...piecePickers(
    {
      category: model.category,
      categoryMissing: model.categoryMissing,
      subcategory: model.subcategory,
      colours: model.colours,
      coloursLegend: 'wardrobe.addPieceColorsLabel',
      messages: Message,
    },
    locale,
    h,
  ),
  h.label([h.For('piece-name'), ...styled(h, fieldLabel())], [format(locale, 'wardrobe.nameOptionalLabel', {})]),
  h.input([
    h.Id('piece-name'),
    h.Name('name'),
    h.Type('text'),
    h.Maxlength(80),
    h.Autocomplete('off'),
    h.Value(model.name),
    h.OnInput((value) => Message.UpdatedName({ value })),
    ...styled(h, textField()),
  ]),
]

/** Add a piece by hand: a photo, what it is, and optionally its colours and a name. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) => {
  const busy = !(Submission.guards.Idle(model.submission) || Submission.guards.Failed(model.submission))
  return h.main(
    [h.Id('main'), ...styled(h, styles.addPage())],
    [
      h.div(styled(h, styles.pageBar()), [
        h.a(
          [
            h.Href(wardrobeRouter({})),
            h.AriaLabel(format(locale, 'wardrobe.backToWardrobe', {})),
            ...styled(h, styles.back()),
          ],
          [backIcon(h)],
        ),
      ]),
      h.h1([], [format(locale, 'wardrobe.addPieceTitle', {})]),
      h.p(styled(h, styles.lede()), [format(locale, 'wardrobe.addPieceHint', {})]),
      h.form(
        [h.OnSubmit(Message.SubmittedPiece()), h.AriaBusy(busy), h.Attribute('novalidate', '')],
        [
          photoSection(model, locale, h),
          ...pieceFields(model, locale, h),
          Submission.guards.Failed(model.submission)
            ? h.p([h.Role('alert'), ...styled(h, formError())], [format(locale, 'wardrobe.addPieceFailed', {})])
            : h.empty,
          actionButton(
            {
              label: format(locale, busyLabel(model), {}),
              style: cx(primaryAction(), styles.submit()),
              type: 'submit',
              isDisabled: busy,
              leading: busy ? loader(h) : h.empty,
            },
            h,
          ),
        ],
      ),
    ],
  )
})
