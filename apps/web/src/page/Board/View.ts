import { format, type Locale } from '@styld/i18n'
import {
  type BoardItem,
  ImageItem,
  type Paper,
  type Piece,
  PieceItem,
  PicturePin,
  PiecePin,
  TextItem,
} from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { backIcon, loader } from '../../Icon.ts'
import { boardRouter, lookRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { MeasurePaper } from './Commands.ts'
import { boardImage, itemContent, itemStyle, pieceImage, placement } from './Table.ts'
import { type KeyStep, Message } from './Message.ts'
import { Gesture, LookSave, type Model, Saving, Toast, Upload } from './Model.ts'
import { boardStateView } from './Unready.ts'
import * as styles from './View.styles.ts'
import { selectionView, toolbarView } from './ViewTools.ts'

const primaryButton = 0

const keySteps: ReadonlyMap<string, KeyStep> = new Map([
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['+', 'bigger'],
  ['=', 'bigger'],
  ['-', 'smaller'],
  ['_', 'smaller'],
  ['[', 'turnLeft'],
  [']', 'turnRight'],
  ['Delete', 'remove'],
  ['Backspace', 'remove'],
])

const heldId = (gesture: Gesture): Option.Option<string> =>
  Gesture.match(gesture, {
    Idle: () => Option.none(),
    Dragging: ({ id }) => Option.some(id),
    Pinching: ({ id }) => Option.some(id),
    Turning: ({ id }) => Option.some(id),
  })

const pieceName = (pieces: ReadonlyArray<Piece>, pieceId: string, locale: Locale) =>
  Option.getOrElse(
    Option.flatMap(
      Array.findFirst(pieces, (piece) => piece.id === pieceId),
      (piece) => Option.fromNullishOr(piece.name),
    ),
    () => format(locale, 'board.pieceFallback', {}),
  )

const wardrobePieces = (model: Model): ReadonlyArray<Piece> =>
  Option.getOrElse(AsyncData.getData(model.wardrobe.pieces), () => [])

/** What an item is called for assistive technology. */
const itemLabel = (model: Model, item: BoardItem, locale: Locale) => {
  if (Schema.is(PieceItem)(item)) return pieceName(wardrobePieces(model), item.pieceId, locale)
  if (Schema.is(TextItem)(item)) return format(locale, 'board.textItem', { text: item.text })
  return format(locale, 'board.picture', {})
}

/** The corner handle reports the item's centre on the page with the press: its parent's bounding box is
 * centred on the item however it is turned. */
const handleView = (item: BoardItem, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.span([
    h.AriaHidden(true),
    h.Title(format(locale, 'board.turnHandle', {})),
    ...styled(h, styles.handle()),
    h.OnPointerDown((_type, button, _sx, _sy, _time, clientX, clientY, pointerId, target) => {
      const box = target instanceof Element ? target.parentElement?.getBoundingClientRect() : undefined
      return button === primaryButton && box !== undefined
        ? Option.some(
            Message.PressedHandle({
              id: item.id,
              pointer: { pointerId, x: clientX, y: clientY },
              centerX: box.left + box.width / 2,
              centerY: box.top + box.height / 2,
            }),
          )
        : Option.none()
    }),
  ])

const itemView = (model: Model, item: BoardItem, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const isSelected = Option.contains(model.maybeSelectedId, item.id)
  const isHeld = Option.contains(heldId(model.gesture), item.id)
  return h.keyed('div')(
    item.id,
    [
      h.Role('button'),
      h.Tabindex(0),
      h.AriaLabel(itemLabel(model, item, locale)),
      h.AriaPressed(isSelected ? 'true' : 'false'),
      h.AriaDescribedBy('board-keys'),
      h.DataAttribute('item', item.id),
      ...(isSelected ? [h.DataAttribute('selected', '')] : []),
      ...(isHeld ? [h.DataAttribute('held', '')] : []),
      ...styled(h, itemStyle(item)),
      h.Style(placement(item)),
      h.OnPointerDown((type, button, _sx, _sy, _time, clientX, clientY, pointerId) =>
        button === primaryButton
          ? Option.some(
              Message.PressedItem({
                id: item.id,
                pointer: { pointerId, x: clientX, y: clientY },
                isTouch: type === 'touch',
              }),
            )
          : Option.none(),
      ),
      h.OnFocus(Message.FocusedItem({ id: item.id })),
      h.OnKeyDownPreventDefault((key, modifiers) =>
        Option.flatMap(Option.fromNullishOr(keySteps.get(key)), (step) =>
          modifiers.metaKey || modifiers.ctrlKey
            ? Option.none()
            : Option.some(Message.PressedItemKey({ id: item.id, step, isShifted: modifiers.shiftKey })),
        ),
      ),
    ],
    [itemContent(item, h), isSelected ? handleView(item, locale, h) : h.empty],
  )
}

const leavingView = (item: BoardItem, h: HtmlBuilder<Message>): Html =>
  h.keyed('div')(
    `leaving-${item.id}`,
    [h.AriaHidden(true), h.DataAttribute('leaving', ''), ...styled(h, itemStyle(item)), h.Style(placement(item))],
    [itemContent(item, h)],
  )

const paperView = (model: Model, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.AriaLabel(format(locale, 'board.paper', {})),
      h.DataAttribute('paper', paper),
      ...(model.isDropping ? [h.DataAttribute('dropping', '')] : []),
      ...styled(h, styles.paper()),
      h.OnMount(MeasurePaper()),
      h.OnPointerDown((_type, _button, _sx, _sy, _time, clientX, clientY, pointerId) =>
        Option.some(Message.PressedPaper({ pointer: { pointerId, x: clientX, y: clientY } })),
      ),
    ],
    [
      ...Array.map(model.items, (item) => itemView(model, item, locale, h)),
      ...Array.map(model.leaving, (item) => leavingView(item, h)),
      Array.isReadonlyArrayEmpty(model.items) && Array.isReadonlyArrayEmpty(model.leaving)
        ? h.p(styled(h, styles.emptyHint()), [format(locale, 'board.empty', {})])
        : h.empty,
      model.isDropping ? h.p(styled(h, styles.dropHint()), [format(locale, 'board.dropHere', {})]) : h.empty,
    ],
  )

const savingStatus = (model: Model, locale: Locale) =>
  Saving.match(model.saving, {
    Saved: () => format(locale, 'board.saved', {}),
    Waiting: () => format(locale, 'board.saving', {}),
    InFlight: () => format(locale, 'board.saving', {}),
    Failed: () => format(locale, 'board.saveFailed', {}),
    Replaced: () => format(locale, 'board.replaced', {}),
  })

const statusView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const upload = Upload.match(model.upload, {
    Idle: () => Option.none<string>(),
    Sending: ({ count }) => Option.some(format(locale, 'board.sending', { count })),
    Failed: ({ refused }) => Option.some(format(locale, refused ? 'board.pictureRefused' : 'board.pictureFailed', {})),
  })
  const failed = Saving.guards.Failed(model.saving) || Upload.guards.Failed(model.upload)
  return h.p(
    [h.Role('status'), ...(failed ? [h.DataAttribute('tone', 'error')] : []), ...styled(h, styles.status())],
    [Option.getOrElse(upload, () => savingStatus(model, locale))],
  )
}

const toastView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Toast.match(model.toast, {
    Hidden: () => h.empty,
    Removed: () =>
      h.div(
        [h.Role('status'), ...styled(h, styles.toast())],
        [
          h.span([], [format(locale, 'board.removed', {})]),
          actionButton(
            {
              label: format(locale, 'board.undoRemove', {}),
              style: styles.toastAction(),
              onClick: Message.ClickedUndoRemove(),
            },
            h,
          ),
        ],
      ),
  })

const lookView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  LookSave.match(model.look, {
    Idle: () => h.empty,
    Saving: () => h.p([h.Role('status'), ...styled(h, styles.fine())], [format(locale, 'board.lookSaving', {})]),
    Saved: ({ lookId }) =>
      h.p(
        [h.Role('status'), ...styled(h, styles.fine())],
        [
          format(locale, 'board.lookSaved', {}),
          ' ',
          h.a([h.Href(lookRouter({ lookId }))], [format(locale, 'board.openLook', {})]),
        ],
      ),
    Failed: () => h.p([h.Role('alert'), ...styled(h, styles.status())], [format(locale, 'board.lookFailed', {})]),
    NoPieces: () => h.p([h.Role('status'), ...styled(h, styles.fine())], [format(locale, 'board.lookNoPieces', {})]),
  })

const trayPiece = (piece: Piece, isOn: boolean, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const name = piece.name ?? format(locale, 'board.pieceFallback', {})
  return h.keyed('li')(
    piece.id,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed(isOn ? 'true' : 'false'),
          h.AriaLabel(format(locale, isOn ? 'board.takePiece' : 'board.addPiece', { name })),
          ...styled(h, styles.trayPiece()),
          h.OnClick(Message.ClickedWardrobePiece({ pieceId: piece.id })),
        ],
        [h.img([h.Src(pieceImage(piece.id)), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.trayImage())])],
      ),
    ],
  )
}

/** A picture pinned on the board but off its table: a tap lays it back. */
const trayPicture = (imageId: PicturePin['imageId'], locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    imageId,
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaPressed('false'),
          h.AriaLabel(format(locale, 'board.placePicture', {})),
          ...styled(h, styles.trayPiece()),
          h.OnClick(Message.ClickedPinnedPicture({ imageId })),
        ],
        [h.img([h.Src(boardImage(imageId, 'thumb')), h.Alt(''), h.Loading('lazy'), ...styled(h, styles.trayImage())])],
      ),
    ],
  )

/** The tray: what is pinned on the board first, then the rest of the wardrobe. */
const trayView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const onTable = new Set(Array.flatMap(model.items, (item) => (Schema.is(PieceItem)(item) ? [item.pieceId] : [])))
  const picturesOnTable = new Set(
    Array.flatMap(model.items, (item) => (Schema.is(ImageItem)(item) ? [item.imageId] : [])),
  )
  const pinnedPieces = Array.flatMap(model.pins, (pin) =>
    Schema.is(PiecePin)(pin) && pin.piece.status === 'ready' ? [pin.piece] : [],
  )
  const pinnedIds = new Set(pinnedPieces.map(({ id }) => id))
  const offTable = Array.flatMap(model.pins, (pin) =>
    Schema.is(PicturePin)(pin) && !picturesOnTable.has(pin.imageId) ? [pin.imageId] : [],
  )
  const body = AsyncData.matchData(model.wardrobe.pieces, {
    onEmpty: () => h.p([h.Role('status'), ...styled(h, styles.fine())], [loader(h)]),
    onFailure: () => h.p([h.Role('alert'), ...styled(h, styles.fine())], [format(locale, 'board.wardrobeFailed', {})]),
    onData: (pieces) => {
      const rest = Array.filter(pieces, (piece) => piece.status === 'ready' && !pinnedIds.has(piece.id))
      const offered = [...pinnedPieces, ...rest]
      return offered.length + offTable.length === 0
        ? h.p(styled(h, styles.fine()), [format(locale, 'board.wardrobeEmpty', {})])
        : h.ul(styled(h, styles.trayList()), [
            ...Array.map(offTable, (imageId) => trayPicture(imageId, locale, h)),
            ...Array.map(offered, (piece) => trayPiece(piece, onTable.has(piece.id), locale, h)),
          ])
    },
  })
  return h.section(
    [h.AriaLabelledBy('board-tray'), h.DataAttribute('tray', ''), ...styled(h, styles.tray())],
    [h.h2([h.Id('board-tray')], [format(locale, 'board.wardrobe', {})]), body],
  )
}

const readyView = (model: Model, name: string, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.page()), [
    h.header(styled(h, styles.header()), [
      h.a(
        [h.Href(boardRouter({ boardId: model.boardId })), ...styled(h, styles.back())],
        [backIcon(h), format(locale, 'studio.backToBoard', {})],
      ),
      h.h1(styled(h, styles.title()), [name]),
      statusView(model, locale, h),
    ]),
    // On a phone the tray sits right under the table, so a piece tapped in lands in view; on a desktop it
    // takes the column beside the table.
    h.div(styled(h, styles.stage()), [
      toolbarView(model, locale, h),
      paperView(model, paper, locale, h),
      trayView(model, locale, h),
      toastView(model, locale, h),
      selectionView(model, paper, locale, h),
      lookView(model, locale, h),
      h.p([h.Id('board-keys'), ...styled(h, styles.fine())], [format(locale, 'board.keys', {})]),
    ]),
  ])

export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  boardStateView(model.board, (name, paper) => readyView(model, name, paper, locale, h), locale, h),
)
