import { Dialog } from '@foldkit/ui'
import { format, type Locale } from '@styld/i18n'
import { type Look, LookPin, type Paper, type Piece, type Pin, PiecePin } from '@styld/protocol'
import { Array, Match, Option, Schema } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction } from '../../Actions.styles.ts'
import { textField } from '../../Fields.styles.ts'
import { addIcon, backIcon, checkIcon, closeIcon, editIcon, loader } from '../../Icon.ts'
import { boardCollageRouter, boardsRouter, lookRouter, pieceRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { grab, quiet, scrim, sheet, sheetHead, sheetTitle } from '../AskView.styles.ts'
import { Message } from './Message.ts'
import { boardStateView } from './Unready.ts'
import { type Model, PinWork, Removal, Rename } from './Model.ts'
import * as styles from './PageView.styles.ts'
import { boardImage, pieceImage, stillTable } from './Table.ts'

const pieceName = (piece: Piece, locale: Locale) => piece.name ?? format(locale, 'board.pieceFallback', {})

/** The pieces a look shows on its tile: its first four, two by two. */
const lookMosaic = (look: Look, h: HtmlBuilder<Message>): Html =>
  h.span(
    styled(h, styles.mosaic()),
    Array.map(Array.take(look.pieces, 4), (piece) =>
      h.img([h.Src(pieceImage(piece.id)), h.Alt(''), h.Loading('lazy')]),
    ),
  )

const unpinButton = (pinId: Pin['id'], label: string, h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Type('button'), h.AriaLabel(label), ...styled(h, styles.unpin()), h.OnClick(Message.ClickedUnpin({ pinId }))],
    [closeIcon(h)],
  )

const pinView = (pin: Pin, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    pin.id,
    [...styled(h, styles.pin())],
    Match.value(pin).pipe(
      Match.tagsExhaustive({
        PiecePin: ({ id, piece }) => [
          h.a(
            [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.pinLink())],
            [
              h.span(styled(h, styles.pinFrame()), [
                h.img([
                  h.Src(pieceImage(piece.id)),
                  h.Alt(pieceName(piece, locale)),
                  h.Loading('lazy'),
                  ...styled(h, styles.cutout()),
                ]),
              ]),
            ],
          ),
          unpinButton(id, format(locale, 'board.unpin', { name: pieceName(piece, locale) }), h),
        ],
        PicturePin: ({ id, imageId }) => [
          h.span(styled(h, styles.pinFrame()), [
            h.img([
              h.Src(boardImage(imageId, 'thumb')),
              h.Alt(format(locale, 'board.picture', {})),
              h.Loading('lazy'),
              ...styled(h, styles.photo()),
            ]),
          ]),
          unpinButton(id, format(locale, 'board.unpinPicture', {}), h),
        ],
        LookPin: ({ id, look }) => [
          h.a(
            [h.Href(lookRouter({ lookId: look.id })), ...styled(h, styles.pinLink())],
            [
              h.span(styled(h, styles.pinFrame()), [lookMosaic(look, h)]),
              h.span(styled(h, styles.pinName()), [look.name]),
            ],
          ),
          unpinButton(id, format(locale, 'board.unpin', { name: look.name }), h),
        ],
      }),
    ),
  )

const collageView = (model: Model, name: string, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [
      h.Href(boardCollageRouter({ boardId: model.boardId })),
      h.AriaLabel(format(locale, 'studio.openCollage', { name })),
      ...styled(h, styles.collage()),
    ],
    [
      model.items.length === 0
        ? h.span(styled(h, styles.collageEmpty()), [format(locale, 'studio.emptyCollageHint', {})])
        : stillTable(model.items, paper, [], h),
      h.span(styled(h, styles.collageLabel()), [
        format(locale, model.items.length === 0 ? 'studio.makeCollage' : 'studio.editCollage', {}),
      ]),
    ],
  )

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
            Array.map(pins, (pin) => pinView(pin, locale, h)),
          ),
      }),
    ],
  )

/** A sheet from the bottom edge, after Ask's: drawn only while open, its layout set in the browser. */
const sheetView = (
  slotId: string,
  dialog: Dialog.Model,
  title: string,
  body: (info: Dialog.RenderInfo) => ReadonlyArray<Html>,
  toParentMessage: (message: Dialog.Message) => Message,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    model: dialog,
    view: Dialog.view,
    viewInputs: {
      toView: (info: Dialog.RenderInfo) =>
        h.dialog(
          [...info.dialog],
          [
            h.div([...info.backdrop, ...styled(h, scrim())]),
            h.div(
              [...info.panel, ...styled(h, sheet())],
              [
                h.span([h.AriaHidden(true), ...styled(h, grab())]),
                h.div(styled(h, sheetHead()), [
                  h.h2([...info.title, ...styled(h, sheetTitle())], [title]),
                  h.button(
                    [...info.closeButton, h.AriaLabel(format(locale, 'common.close', {})), ...styled(h, quiet())],
                    [closeIcon(h)],
                  ),
                ]),
                h.div(styled(h, styles.sheetBody()), body(info)),
              ],
            ),
          ],
        ),
    },
    toParentMessage,
  })

const pickButton = (pick: string, label: string, content: Html, model: Model, h: HtmlBuilder<Message>): Html => {
  const isPicked = model.picks.includes(pick)
  return h.keyed('li')(
    pick,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(isPicked ? 'true' : 'false'),
          h.AriaLabel(label),
          ...styled(h, styles.pick()),
          h.OnClick(Message.ToggledPick({ pick })),
        ],
        [content, isPicked ? h.span(styled(h, styles.picked()), [checkIcon(h)]) : h.empty],
      ),
    ],
  )
}

const pickerBody = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const pinned = new Set(
    Array.flatMap(model.pins, (pin) => {
      if (Schema.is(PiecePin)(pin)) return [`piece:${pin.piece.id}`]
      return Schema.is(LookPin)(pin) ? [`look:${pin.look.id}`] : []
    }),
  )
  const pieces = Array.filter(
    Option.getOrElse(AsyncData.getData(model.wardrobe.pieces), () => []),
    (piece) => piece.status === 'ready' && !pinned.has(`piece:${piece.id}`),
  )
  const looks = Array.filter(
    Option.getOrElse(AsyncData.getData(model.looks), () => []),
    (look) => !pinned.has(`look:${look.id}`),
  )
  const sending = PinWork.guards.Sending(model.pinWork)
  return [
    h.h3(styled(h, styles.sheetSection()), [format(locale, 'studio.addMenuPieces', {})]),
    Array.match(pieces, {
      onEmpty: () => h.p(styled(h, styles.meta()), [format(locale, 'board.pickerEmpty', {})]),
      onNonEmpty: (ready) =>
        h.ul(
          styled(h, styles.pickGrid()),
          Array.map(ready, (piece) =>
            pickButton(
              `piece:${piece.id}`,
              pieceName(piece, locale),
              h.img([h.Src(pieceImage(piece.id)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.cutout())]),
              model,
              h,
            ),
          ),
        ),
    }),
    AsyncData.isFailure(model.looks)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'board.looksFailed', {})])
      : looks.length === 0
        ? h.empty
        : h.div(styled(h, styles.head()), [
            h.h3(styled(h, styles.sheetSection()), [format(locale, 'studio.addMenuLooks', {})]),
            h.ul(
              styled(h, styles.pickGrid()),
              Array.map(looks, (look) => pickButton(`look:${look.id}`, look.name, lookMosaic(look, h), model, h)),
            ),
          ]),
    PinWork.guards.Failed(model.pinWork)
      ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.addFailed', {})])
      : h.empty,
    actionButton(
      {
        label: sending
          ? format(locale, 'studio.pinning', {})
          : format(locale, 'board.pickSelected', { count: model.picks.length }),
        style: primaryAction(),
        isDisabled: sending || model.picks.length === 0,
        leading: sending ? loader(h) : addIcon(h),
        onClick: Message.SubmittedPicks(),
      },
      h,
    ),
  ]
}

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
              h.Attribute('maxlength', '60'),
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
    removalView(model, locale, h),
  ]
}

const readyView = (model: Model, name: string, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    h.div(styled(h, styles.bar()), [
      h.a(
        [h.Href(boardsRouter({})), ...styled(h, styles.back())],
        [backIcon(h), format(locale, 'studio.backToBoards', {})],
      ),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(format(locale, 'studio.boardSettings', {})),
          ...styled(h, styles.round()),
          h.OnClick(Message.ClickedSettings()),
        ],
        [editIcon(h)],
      ),
    ]),
    h.div(styled(h, styles.head()), [
      h.h1([], [name]),
      h.p(styled(h, styles.meta()), [format(locale, 'studio.pinCount', { count: model.pins.length })]),
    ]),
    collageView(model, name, paper, locale, h),
    pinsView(model, locale, h),
    model.settings.isOpen
      ? sheetView(
          'board-settings',
          model.settings,
          format(locale, 'studio.boardSettings', {}),
          (info) => settingsBody(model, locale, h, info),
          (message) => Message.GotSettingsMessage({ message }),
          locale,
          h,
        )
      : h.empty,
    model.picker.isOpen
      ? sheetView(
          'board-picker',
          model.picker,
          format(locale, 'board.pickerTitle', { name }),
          () => pickerBody(model, locale, h),
          (message) => Message.GotPickerMessage({ message }),
          locale,
          h,
        )
      : h.empty,
  ])

/** A board's page: its collage as a card that opens the editor, then its pins, newest first. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  boardStateView(model.board, (name, paper) => readyView(model, name, paper, locale, h), locale, h),
)
