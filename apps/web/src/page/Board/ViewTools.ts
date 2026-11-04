import { Button, FileDrop } from '@foldkit/ui'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { type BoardItem, Paper, PieceItem, TextItem, TextStyle, textLength, topZ } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import {
  addIcon,
  copyIcon,
  deleteIcon,
  flipIcon,
  forwardIcon,
  backwardIcon,
  pasteIcon,
  photoIcon,
  redoIcon,
  textIcon,
  tidyIcon,
  undoIcon,
} from '../../Icon.ts'
import { styled } from '../../Styled.ts'
import { pictureAccept } from '../../Upload.ts'
import { visuallyHidden } from '../../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import { findItem } from './Edits.ts'
import { Message } from './Message.ts'
import { LookSave, type Model, Ticks, Upload } from './Model.ts'
import * as styles from './View.styles.ts'

/** An icon and its name; on a phone the name is read, not shown, so the tools keep to one row above the table. */
const tool = (label: string, icon: Html, message: Message, isDisabled: boolean, h: HtmlBuilder<Message>): Html =>
  Button.view(
    {
      onClick: message,
      isDisabled,
      toView: (attributes) =>
        h.button(
          [...attributes.button, h.Title(label), ...styled(h, styles.tool())],
          [icon, h.span(styled(h, styles.toolLabel()), [label])],
        ),
    },
    h,
  )

/** Add a picture: choose one, or drop it here (pictures dropped anywhere on the page work too). */
const pictureTool = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: model.drop.id,
    model: model.drop,
    view: FileDrop.view,
    viewInputs: {
      accept: [pictureAccept],
      multiple: true,
      toView: (attributes) =>
        h.label(
          [...attributes.root, h.Title(format(locale, 'board.addPicture', {})), ...styled(h, styles.tool())],
          [
            photoIcon(h),
            h.span(styled(h, styles.toolLabel()), [format(locale, 'board.addPicture', {})]),
            h.input(attributes.input),
          ],
        ),
    },
    toParentMessage: (message) => Message.GotDropMessage({ message }),
  })

export const toolbarView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('toolbar'), h.AriaLabel(format(locale, 'board.tools', {})), ...styled(h, styles.tools())],
    [
      tool(
        format(locale, 'board.undo', {}),
        undoIcon(h),
        Message.ClickedUndo(),
        Array.isReadonlyArrayEmpty(model.past),
        h,
      ),
      tool(
        format(locale, 'board.redo', {}),
        redoIcon(h),
        Message.ClickedRedo(),
        Array.isReadonlyArrayEmpty(model.future),
        h,
      ),
      tool(
        format(locale, 'board.tidy', {}),
        tidyIcon(h),
        Message.ClickedTidy(),
        Array.isReadonlyArrayEmpty(model.items),
        h,
      ),
      tool(
        format(locale, 'board.addText', {}),
        textIcon(h),
        Message.ClickedAddText({ text: format(locale, 'board.newText', {}) }),
        false,
        h,
      ),
      pictureTool(model, locale, h),
      tool(
        format(locale, 'board.paste', {}),
        pasteIcon(h),
        Message.ClickedPaste(),
        model.isPasting || Upload.guards.Sending(model.upload),
        h,
      ),
    ],
  )

/** How many pieces are ticked in select mode, none when it is off. */
const tickedPieces = (model: Model): Option.Option<number> =>
  Ticks.match(model.ticks, {
    Off: () => Option.none(),
    On: ({ itemIds }) =>
      Option.some(Array.filter(model.items, (item) => Schema.is(PieceItem)(item) && itemIds.includes(item.id)).length),
  })

/** Select pieces for a look (T-16), and Save as a look: the ticked pieces in select mode, else every piece on the
 * table. It waits for a piece, and says why to a screen reader. */
export const saveLookView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const hasPieces = Array.some(model.items, Schema.is(PieceItem))
  const ticked = tickedPieces(model)
  const canSave = Option.match(ticked, { onNone: () => hasPieces, onSome: (count) => count > 0 })
  const hint = Option.isSome(ticked) ? 'board.selectHint' : 'board.lookNoPieces'
  return h.div(styled(h, styles.saveLook()), [
    actionButton(
      {
        label: format(locale, Option.isSome(ticked) ? 'board.selectDone' : 'board.select', {}),
        style: cx(secondaryAction(), smallAction()),
        onClick: Option.isSome(ticked) ? Message.ClickedDoneSelecting() : Message.ClickedSelect(),
        isDisabled: !hasPieces,
        pressed: Option.isSome(ticked),
      },
      h,
    ),
    actionButton(
      {
        label: Option.match(ticked, {
          onNone: () => format(locale, 'board.saveLook', {}),
          onSome: (count) =>
            count > 0 ? format(locale, 'board.saveSelectedLook', { count }) : format(locale, 'board.saveLook', {}),
        }),
        leading: addIcon(h),
        style: cx(primaryAction(), smallAction()),
        onClick: Message.ClickedSaveLook(),
        isDisabled: !canSave || LookSave.guards.Saving(model.look),
        ...(canSave ? {} : { describedBy: 'board-look-hint' }),
      },
      h,
    ),
    canSave ? h.empty : h.span([h.Id('board-look-hint'), ...styled(h, visuallyHidden())], [format(locale, hint, {})]),
  ])
}

/** In select mode, what a tap does now. */
export const selectHintView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Ticks.guards.On(model.ticks)
    ? h.p([h.Role('status'), ...styled(h, styles.fine())], [format(locale, 'board.selectHint', {})])
    : h.empty

const textStyles: ReadonlyArray<readonly [TextStyle, MessageKey]> = [
  ['label', 'board.styleLabel'],
  ['headline', 'board.styleHeadline'],
]

const textEditor = (item: typeof TextItem.Type, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.editor()), [
    h.label([h.For('board-text'), ...styled(h, styles.fine())], [format(locale, 'board.text', {})]),
    h.textarea([
      h.Id('board-text'),
      h.Rows(2),
      h.Value(item.text),
      h.Maxlength(textLength.label),
      ...styled(h, styles.field()),
      h.OnInput((text) => Message.UpdatedText({ id: item.id, text })),
    ]),
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'board.textStyle', {})), ...styled(h, styles.choices())],
      Array.map(textStyles, ([style, key]) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(item.style === style ? 'true' : 'false'),
            ...styled(h, styles.choice()),
            h.OnClick(Message.SelectedTextStyle({ id: item.id, style })),
          ],
          [format(locale, key, {})],
        ),
      ),
    ),
  ])

const itemActions = (item: BoardItem, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('toolbar'), h.AriaLabel(format(locale, 'board.selected', {})), ...styled(h, styles.selectionRow())],
    [
      tool(format(locale, 'board.flip', {}), flipIcon(h), Message.ClickedFlip({ id: item.id }), false, h),
      tool(format(locale, 'board.duplicate', {}), copyIcon(h), Message.ClickedDuplicate({ id: item.id }), false, h),
      tool(
        format(locale, item.z === topZ(model.items) ? 'board.sendBack' : 'board.bringFront', {}),
        item.z === topZ(model.items) ? backwardIcon(h) : forwardIcon(h),
        Message.ClickedLayer({ id: item.id }),
        model.items.length < 2,
        h,
      ),
      tool(format(locale, 'board.remove', {}), deleteIcon(h), Message.ClickedRemove({ id: item.id }), false, h),
    ],
  )

const paperKeys: Readonly<Record<Paper, MessageKey>> = {
  paper: 'board.paper_paper',
  stock: 'board.paper_stock',
  sand: 'board.paper_sand',
  sage: 'board.paper_sage',
  slate: 'board.paper_slate',
  clay: 'board.paper_clay',
}

const paperChoice = (current: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.selectionRow()), [
    h.span(styled(h, styles.fine()), [format(locale, 'board.paperColour', {})]),
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'board.paperColour', {})), ...styled(h, styles.choices())],
      Array.map(Paper.literals, (paper) =>
        h.button([
          h.Type('button'),
          h.AriaPressed(paper === current ? 'true' : 'false'),
          h.AriaLabel(format(locale, paperKeys[paper], {})),
          h.DataAttribute('paper', paper),
          ...styled(h, styles.swatch()),
          h.OnClick(Message.SelectedPaper({ paper })),
        ]),
      ),
    ),
  ])

const selected = (model: Model) => Option.flatMap(model.maybeSelectedId, (id) => findItem(model.items, id))

/** The selected item's actions, and a text label's words and style. They ride at the top of the tray, which holds
 * the bottom of a phone's screen and the column beside a desktop's table, so they are in view while the item is. */
export const selectedView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(selected(model), {
    onNone: () => h.empty,
    onSome: (item) =>
      h.div(styled(h, styles.selection()), [
        itemActions(item, model, locale, h),
        Schema.is(TextItem)(item) ? textEditor(item, locale, h) : h.empty,
      ]),
  })

/** With nothing selected, the paper's colours, under the table. */
export const paperChoiceView = (model: Model, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.isSome(selected(model)) ? h.empty : h.div(styled(h, styles.selection()), [paperChoice(paper, locale, h)])
