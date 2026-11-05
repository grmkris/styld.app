import { piecesById } from '../../../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import {
  type Arrow,
  type BoardItem,
  layoutArrows,
  type OutfitsAround,
  type Paper,
  type Piece,
  type Pin,
  PieceItem,
  TextItem,
} from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../../ActionButton.ts'
import { lookRouter } from '../../../route.ts'
import { styled } from '../../../Styled.ts'
import { type PiecesData, readPieces } from '../../../ServerData.ts'
import { MeasurePaper } from './Commands.ts'
import { fromStyld, type ImageSource, itemContent, itemStyle, placement } from '../Table.ts'
import { Gesture, LookSave, type Model, Saving, Ticks, Toast, Upload, uploadProblem } from './Model.ts'
import { type KeyStep, Message } from './Message.ts'
import * as styles from '../View.styles.ts'
import * as AddSheetView from '../AddSheetView.ts'
import { pieceDescription } from '../../WardrobeWords.ts'
import { paperChoiceView, selectHintView, selectedView, toolbarView } from './ViewTools.ts'

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
  Option.match(
    Array.findFirst(pieces, (piece) => piece.id === pieceId),
    {
      onNone: () => format(locale, 'board.pieceFallback', {}),
      onSome: (piece) => pieceDescription(piece, locale),
    },
  )

/** What an item is called for assistive technology. */
const itemLabel = (pieces: PiecesData, item: BoardItem, locale: Locale) => {
  if (Schema.is(PieceItem)(item)) return pieceName(readPieces(pieces), item.pieceId, locale)
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

const itemView = (
  model: Model,
  pieces: PiecesData,
  source: ImageSource,
  item: BoardItem,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const isSelected = Option.contains(model.maybeSelectedId, item.id)
  const isHeld = Option.contains(heldId(model.gesture), item.id)
  // In select mode (T-16) a tap or Space ticks the item for a look, or unticks it, and nothing moves.
  const ticks = Ticks.guards.On(model.ticks) ? Option.some(model.ticks.itemIds) : Option.none()
  const isTicked = Option.exists(ticks, (ids) => ids.includes(item.id))
  const tick = Option.some(Message.ToggledTick({ id: item.id }))
  return h.keyed('div')(
    item.id,
    [
      h.Role('button'),
      h.Tabindex(0),
      h.AriaLabel(itemLabel(pieces, item, locale)),
      h.AriaPressed(isSelected || isTicked ? 'true' : 'false'),
      h.AriaDescribedBy('board-keys'),
      h.DataAttribute('item', item.id),
      ...(isSelected ? [h.DataAttribute('selected', '')] : []),
      ...(isTicked ? [h.DataAttribute('ticked', '')] : []),
      ...(isHeld ? [h.DataAttribute('held', '')] : []),
      ...styled(h, itemStyle(item)),
      h.Style(placement(item)),
      h.OnPointerDown((type, button, _sx, _sy, _time, clientX, clientY, pointerId) =>
        button !== primaryButton
          ? Option.none()
          : Option.isSome(ticks)
            ? tick
            : Option.some(
                Message.PressedItem({
                  id: item.id,
                  pointer: { pointerId, x: clientX, y: clientY },
                  isTouch: type === 'touch',
                }),
              ),
      ),
      h.OnFocus(Message.FocusedItem({ id: item.id })),
      h.OnKeyDownPreventDefault((key, modifiers) =>
        Option.isSome(ticks)
          ? key === ' ' || key === 'Enter'
            ? tick
            : Option.none()
          : Option.flatMap(Option.fromNullishOr(keySteps.get(key)), (step) =>
              modifiers.metaKey || modifiers.ctrlKey
                ? Option.none()
                : Option.some(Message.PressedItemKey({ id: item.id, step, isShifted: modifiers.shiftKey })),
            ),
      ),
    ],
    [itemContent(item, h, 'full', source), isSelected ? handleView(item, locale, h) : h.empty],
  )
}

const leavingView = (item: BoardItem, source: ImageSource, h: HtmlBuilder<Message>): Html =>
  h.keyed('div')(
    `leaving-${item.id}`,
    [h.AriaHidden(true), h.DataAttribute('leaving', ''), ...styled(h, itemStyle(item)), h.Style(placement(item))],
    [itemContent(item, h, 'full', source)],
  )

/** An arrow's line and its open head, in the table's units, rounded. */
const arrowPath = ({ x1, y1, x2, y2 }: Arrow) => {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = 26
  const spread = 0.5
  const point = (turn: number) =>
    `${(x2 - head * Math.cos(angle + turn)).toFixed(1)} ${(y2 - head * Math.sin(angle + turn)).toFixed(1)}`
  const end = `${x2.toFixed(1)} ${y2.toFixed(1)}`
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${end}M${point(-spread)}L${end}L${point(spread)}`
}

/** The thin arrows a "One piece, many outfits" board draws from its piece to each outfit (the layout's decoration,
 * Eva's references): drawn from the table as it is, so an outfit moved out of its place loses its arrow. */
const arrowsView = (model: Model, around: Option.Option<OutfitsAround>, h: HtmlBuilder<Message>): Html =>
  Option.match(around, {
    onNone: () => h.empty,
    onSome: ({ anchor, outfits, layout }) => {
      const arrows =
        anchor === null
          ? []
          : layoutArrows(
              layout,
              anchor.id,
              outfits.map((outfit) => outfit.pieces.map(({ id }) => id)),
              model.items,
            )
      return Array.isReadonlyArrayEmpty(arrows)
        ? h.empty
        : h.svg(
            [
              h.ViewBox('0 0 1000 1250'),
              h.AriaHidden(true),
              h.DataAttribute('arrows', ''),
              ...styled(h, styles.arrows()),
            ],
            arrows.map((arrow) => h.path([h.D(arrowPath(arrow))])),
          )
    },
  })

const paperView = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { pieces, paper, locale } = inputs
  const source = fromStyld(piecesById(readPieces(pieces)))
  return h.section(
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
      arrowsView(model, inputs.around, h),
      ...Array.map(model.items, (item) => itemView(model, pieces, source, item, locale, h)),
      ...Array.map(model.leaving, (item) => leavingView(item, source, h)),
      Array.isReadonlyArrayEmpty(model.items) && Array.isReadonlyArrayEmpty(model.leaving)
        ? h.p(styled(h, styles.emptyHint()), [format(locale, 'board.empty', {})])
        : h.empty,
      model.isDropping ? h.p(styled(h, styles.dropHint()), [format(locale, 'board.dropHere', {})]) : h.empty,
    ],
  )
}

const savingStatus = (model: Model, locale: Locale) =>
  Saving.match(model.saving, {
    Saved: () => format(locale, 'board.saved', {}),
    Waiting: () => format(locale, 'board.saving', {}),
    InFlight: () => format(locale, 'board.saving', {}),
    Failed: () => format(locale, 'board.saveFailed', {}),
    Replaced: () => format(locale, 'board.replaced', {}),
  })

const statusView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const problem = uploadProblem(model.upload)
  const upload = Upload.guards.Sending(model.upload)
    ? Option.some(format(locale, 'board.sending', { count: model.upload.count }))
    : Option.map(problem, (failed) =>
        format(locale, failed === 'refused' ? 'board.pictureRefused' : 'board.pictureFailed', {}),
      )
  const failed = Saving.guards.Failed(model.saving) || Option.isSome(problem)
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

/** What the board tells its editor: the wardrobe, the board's paper and pins, and a "One piece, many outfits" board's
 * outfits around its piece. */
export type Inputs = {
  readonly pieces: PiecesData
  readonly paper: Paper
  readonly pins: ReadonlyArray<Pin>
  readonly around: Option.Option<OutfitsAround>
  readonly locale: Locale
}

/** The editable canvas, its controls and the Add sheet, shared by both board addresses. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) => {
  const { pieces, paper, locale } = inputs
  return h.div(styled(h, styles.stage()), [
    toolbarView(model, locale, h),
    statusView(model, locale, h),
    selectHintView(model, locale, h),
    lookView(model, locale, h),
    paperView(model, inputs, h),
    toastView(model, locale, h),
    h.div(
      [h.DataAttribute('tray', ''), ...styled(h, styles.tray())],
      [
        selectedView(model, locale, h),
        h.submodel({
          slotId: 'board-add-button',
          model: model.addSheet,
          view: AddSheetView.buttonView,
          viewInputs: { locale },
          toParentMessage: (message) => Message.GotAddSheetMessage({ message }),
        }),
      ],
    ),
    paperChoiceView(model, paper, locale, h),
    h.p([h.Id('board-keys'), ...styled(h, styles.keys())], [format(locale, 'board.keys', {})]),
    h.submodel({
      slotId: 'board-add-sheet',
      model: model.addSheet,
      view: AddSheetView.sheetView,
      viewInputs: { pieces, locale, items: model.items, pins: inputs.pins },
      toParentMessage: (message) => Message.GotAddSheetMessage({ message }),
    }),
  ])
})
