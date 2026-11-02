import { cdn } from '../../Cdn.ts'
import { Dialog } from '@foldkit/ui'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Mood, type Paper, type Piece, type Pin, type PublicBoard, textLength } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import { textField } from '../../Fields.styles.ts'
import { addIcon, backIcon, loader } from '../../Icon.ts'
import { boardCollageRouter, boardsRouter, lookRouter, pieceRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import * as PeopleView from '../PeopleView.ts'
import { publicToggle } from '../PublicToggle.ts'
import { bottomSheet, sheetShown } from '../Sheet.ts'
import { checkNotice } from '../CheckNotice.ts'
import { Message } from './Message.ts'
import { unpinButton } from './Unpin.ts'
import { boardStateView } from './Unready.ts'
import { lookMosaic, pickerBody } from './PickerView.ts'
import { pieceDescription } from '../WardrobeWords.ts'
import { visitingView } from './Visiting.ts'
import { type Model, PinWork, Publishing, Removal, Rename } from './Model.ts'
import { chip, chosen } from '../../Controls.styles.ts'
import * as MakeView from './MakeView.ts'
import { generatedMark } from './MakeView.ts'
import * as styles from './PageView.styles.ts'
import { boardImage, fromStyld, pinnedPieces, stillTable } from './Table.ts'

/** A pinned thing on the board; one the board shows others without (no picture of its own yet, or Styld's check held
 * it back) says so under it. */
const pinView = (pin: Pin, asking: boolean, heldBack: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    pin.id,
    [...styled(h, styles.pin())],
    [
      ...pinContent(pin, asking, locale, h),
      heldBack ? h.p(styled(h, styles.heldBack()), [format(locale, heldBackReason(pin), {})]) : h.empty,
    ],
  )

/** Why others do not see a pin: a piece needs its own picture and Styld's check; a look, to be shared; anything else
 * waits on the check. */
const heldBackReason = (pin: Pin): MessageKey =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: () => 'board.heldBack' as const,
      LookPin: ({ look }) => (look.shared ? ('board.heldBackCheck' as const) : ('board.heldBackLook' as const)),
      PicturePin: () => 'board.heldBackCheck' as const,
    }),
  )

const pinContent = (pin: Pin, asking: boolean, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: ({ id, piece }) => [
        h.a(
          [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.pinLink())],
          [
            h.span(styled(h, styles.pinFrame()), [
              h.img([
                h.Src(cdn.piece(piece)),
                h.Alt(pieceDescription(piece, locale)),
                h.Loading('lazy'),
                ...styled(h, styles.cutout()),
              ]),
            ]),
          ],
        ),
        unpinButton(
          {
            pinId: id,
            label: format(locale, 'board.unpin', { name: pieceDescription(piece, locale) }),
            question: 'board.unpinAsk',
          },
          asking,
          locale,
          h,
        ),
      ],
      PicturePin: ({ id, imageId, generated }) => [
        h.span(styled(h, styles.pinFrame()), [
          h.img([
            h.Src(boardImage(imageId, 'thumb')),
            h.Alt(format(locale, 'board.picture', {})),
            h.Loading('lazy'),
            ...styled(h, styles.photo()),
          ]),
        ]),
        generated ? generatedMark(locale, h) : h.empty,
        unpinButton(
          { pinId: id, label: format(locale, 'board.unpinPicture', {}), question: 'board.unpinPictureAsk' },
          asking,
          locale,
          h,
        ),
      ],
      LookPin: ({ id, look }) => [
        h.a(
          [h.Href(lookRouter({ lookId: look.id })), ...styled(h, styles.pinLink())],
          [
            h.span(styled(h, styles.pinFrame()), [lookMosaic(look, h)]),
            h.span(styled(h, styles.pinName()), [look.name]),
          ],
        ),
        unpinButton(
          { pinId: id, label: format(locale, 'board.unpin', { name: look.name }), question: 'board.unpinAsk' },
          asking,
          locale,
          h,
        ),
      ],
    }),
  )

/** Public, and this pin is not among those others see. */
const heldBack = (model: Model, pinId: string) => model.visibility === 'public' && !model.publicPins.includes(pinId)

/** Its pins and who sees it; public, how many of them others see when that is fewer (a piece shows others only with a
 * picture of its own, once Styld's check lets it). */
const statusLine = (model: Model, locale: Locale) => {
  const count = model.pins.length
  const shown = model.publicPins.length
  return model.visibility === 'public' && shown < count
    ? format(locale, 'studio.boardStatusPartly', { count, shown })
    : format(locale, 'studio.boardStatus', { count, visibility: model.visibility })
}

/** The collage as a card that opens the editor, named by its visible words. */
const collageView = (model: Model, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(boardCollageRouter({ boardId: model.boardId })), ...styled(h, styles.collage())],
    [
      stillTable(model.items, paper, [], h, fromStyld(pinnedPieces(model.pins))),
      h.span(styled(h, styles.collageLabel()), [format(locale, 'studio.editCollage', {})]),
    ],
  )

/** Nothing laid out yet: one line after the pins and the way into the editor, instead of a blank table above them. */
const collageStartView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.collageStart()), [
    h.p(styled(h, styles.collageStartText()), [
      format(locale, 'studio.emptyCollageHint', { count: model.pins.length }),
    ]),
    h.a(
      [h.Href(boardCollageRouter({ boardId: model.boardId })), ...styled(h, cx(secondaryAction(), smallAction()))],
      [format(locale, 'studio.makeCollage', {})],
    ),
  ])

const pinsView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('board-pins'), ...styled(h, styles.head())],
    [
      h.div(styled(h, styles.pinsHead()), [
        h.h2([h.Id('board-pins'), ...styled(h, styles.pinsTitle())], [format(locale, 'board.pinsTitle', {})]),
        actionButton(
          {
            label: format(locale, 'studio.add', {}),
            style: secondaryAction(),
            leading: addIcon(h),
            onClick: Message.ClickedAddPins(),
          },
          h,
        ),
      ]),
      PinWork.guards.Failed(model.pinWork) && !model.picker.isOpen
        ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.removeFailed', {})])
        : h.empty,
      Array.match(model.pins, {
        onEmpty: () =>
          h.div(styled(h, styles.empty()), [
            h.p(styled(h, styles.emptyTitle()), [format(locale, 'studio.emptyGridTitle', {})]),
            h.p([], [format(locale, 'board.pinsEmptyHint', {})]),
          ]),
        onNonEmpty: (pins) =>
          h.ul(
            styled(h, styles.grid()),
            Array.map(pins, (pin) =>
              pinView(pin, Option.contains(model.unpinning, pin.id), heldBack(model, pin.id), locale, h),
            ),
          ),
      }),
    ],
  )

const removalView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    styled(h, styles.danger()),
    Removal.match(model.removal, {
      Idle: () => [
        h.p([], [format(locale, 'studio.dangerZoneHint', {})]),
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'studio.deleteBoard', {}),
              style: secondaryAction(),
              onClick: Message.ClickedDeleteBoard(),
            },
            h,
          ),
        ]),
      ],
      Confirming: () => [
        h.p([h.Role('alert')], [format(locale, 'studio.deleteConfirm', {})]),
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'studio.delete', {}),
              style: primaryAction(),
              onClick: Message.ClickedConfirmDelete(),
            },
            h,
          ),
          actionButton(
            {
              label: format(locale, 'studio.cancel', {}),
              style: secondaryAction(),
              onClick: Message.ClickedKeepBoard(),
            },
            h,
          ),
        ]),
      ],
      Deleting: () => [h.p([h.Role('status')], [loader(h)])],
      Failed: () => [
        h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.deleteFailed', {})]),
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'studio.retry', {}),
              style: secondaryAction(),
              onClick: Message.ClickedConfirmDelete(),
            },
            h,
          ),
        ]),
      ],
    }),
  )

/** Who sees the board: private, or public on the published profile once Styld's check lets others. */
const sharingView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  publicToggle(
    {
      id: 'board-public',
      isPublic: model.visibility === 'public',
      check: Option.getOrNull(model.check),
      work: Publishing.match(model.publishing, {
        Idle: () => 'idle' as const,
        Sending: () => 'sending' as const,
        Failed: ({ needsProfile }) => (needsProfile ? ('needsProfile' as const) : ('failed' as const)),
      }),
      describe: true,
      onToggle: (isPublic) => Message.ToggledPublic({ isPublic }),
    },
    locale,
    h,
  )

/** The board's moods for Explore: up to three of the six. */
const moodsView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.sharing()), [
    h.p(styled(h, styles.moodsLabel()), [format(locale, 'explore.moodsLabel', {})]),
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'explore.moodsLabel', {})), ...styled(h, styles.moods())],
      Mood.literals.map((mood) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(String(model.moods.includes(mood))),
            h.OnClick(Message.ToggledMood({ mood })),
            ...styled(h, cx(chip(), chosen())),
          ],
          [format(locale, `explore.moods.${mood}`, {})],
        ),
      ),
    ),
  ])

const settingsBody = (
  model: Model,
  locale: Locale,
  h: HtmlBuilder<Message>,
  info: Dialog.RenderInfo,
): ReadonlyArray<Html> => {
  const saving = Rename.guards.Saving(model.rename)
  return [
    h.form(
      [h.OnSubmit(Message.SubmittedRename()), h.Attribute('novalidate', ''), ...styled(h, styles.head())],
      [
        h.label(
          [h.For('board-rename'), ...styled(h, styles.field())],
          [
            format(locale, 'studio.boardName', {}),
            h.input([
              h.Id('board-rename'),
              ...info.initialFocus,
              ...styled(h, textField()),
              h.Value(model.nameDraft),
              h.Maxlength(textLength.boardName),
              h.Readonly(saving),
              h.OnInput((value) => Message.UpdatedNameDraft({ value })),
            ]),
          ],
        ),
        Rename.guards.Failed(model.rename)
          ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.renameFailed', {})])
          : h.empty,
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, saving ? 'saveToBoard.saving' : 'studio.save', {}),
              style: primaryAction(),
              type: 'submit',
              isDisabled: saving,
              leading: saving ? loader(h) : h.empty,
            },
            h,
          ),
        ]),
      ],
    ),
    sharingView(model, locale, h),
    moodsView(model, locale, h),
    removalView(model, locale, h),
  ]
}

/** One part of Make with Styld on the page: its button, its status or its sheet. */
const makeSlot = (
  slotId: string,
  view: typeof MakeView.buttonView,
  model: Model,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    model: model.make,
    view,
    viewInputs: { locale },
    toParentMessage: (message) => Message.GotMakeMessage({ message }),
  })

const readyView = (
  model: Model,
  wardrobe: ReadonlyArray<Piece>,
  name: string,
  paper: Paper,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(styled(h, styles.page()), [
    h.div(styled(h, styles.bar()), [
      h.a(
        [h.Href(boardsRouter({})), ...styled(h, styles.back())],
        [backIcon(h), format(locale, 'studio.backToBoards', {})],
      ),
      h.div(styled(h, styles.barActions()), [
        makeSlot('board-make-button', MakeView.buttonView, model, locale, h),
        // Rename, public, moods and delete: a word a pencil could not say.
        h.button(
          [
            h.Type('button'),
            h.AriaHasPopup('dialog'),
            ...styled(h, cx(secondaryAction(), smallAction())),
            h.OnClick(Message.ClickedSettings()),
          ],
          [format(locale, 'common.edit', {})],
        ),
      ]),
    ]),
    h.div(styled(h, styles.head()), [
      h.h1([], [name]),
      // Where it stands, in one quiet line (DESIGN › Your public things), then the check's word on it.
      h.p(styled(h, styles.meta()), [statusLine(model, locale)]),
      model.visibility === 'public' ? checkNotice(Option.getOrNull(model.check), locale, h) : h.empty,
      makeSlot('board-make-status', MakeView.statusView, model, locale, h),
    ]),
    model.items.length === 0 ? h.empty : collageView(model, paper, locale, h),
    pinsView(model, locale, h),
    model.items.length === 0 ? collageStartView(model, locale, h) : h.empty,
    sheetShown(model.settings)
      ? bottomSheet(
          {
            dialog: model.settings,
            title: format(locale, 'studio.boardSettings', {}),
            body: (info) => [h.div(styled(h, styles.sheetBody()), settingsBody(model, locale, h, info))],
            toParentMessage: (message) => Message.GotSettingsMessage({ message }),
            locale,
          },
          h,
        )
      : h.empty,
    sheetShown(model.picker)
      ? bottomSheet(
          {
            dialog: model.picker,
            title: format(locale, 'board.pickerTitle', { name }),
            body: () => [h.div(styled(h, styles.sheetBody()), pickerBody(model, wardrobe, locale, h))],
            toParentMessage: (message) => Message.GotPickerMessage({ message }),
            locale,
          },
          h,
        )
      : h.empty,
    makeSlot('board-make-sheet', MakeView.sheetView, model, locale, h),
  ])

/** A board's page: its collage as a card that opens the editor, then its pins, newest first. */
export const view = Submodel.defineView<Model, Message, PeopleView.Inputs & { readonly pieces: ReadonlyArray<Piece> }>(
  (model, { locale, signedIn, pieces }, h) => {
    const actions = h.submodel({
      slotId: 'board-people',
      model: model.people,
      view: PeopleView.view,
      viewInputs: { locale, signedIn },
      toParentMessage: (message) => Message.GotPeopleMessage({ message }),
    })
    const visiting = (board: PublicBoard) => visitingView(board, actions, locale, h)
    return boardStateView(
      model.board,
      (name, paper) => readyView(model, pieces, name, paper, locale, h),
      locale,
      h,
      Option.some(visiting),
      signedIn,
    )
  },
)
