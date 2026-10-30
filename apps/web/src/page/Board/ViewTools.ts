import { FileDrop } from '@foldkit/ui'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { type BoardItem, ImageType, Paper, TextItem, TextStyle } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction } from '../../Actions.styles.ts'
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
import { findItem } from './Edits.ts'
import { Message } from './Message.ts'
import { LookSave, type Model, Upload } from './Model.ts'
import * as styles from './View.styles.ts'

const pictureTypes: ReadonlyArray<string> = ImageType.literals

const tool = (label: string, icon: Html, message: Message, isDisabled: boolean, h: HtmlBuilder<Message>): Html =>
  actionButton({ label, leading: icon, style: styles.tool(), onClick: message, isDisabled }, h)

/** Add a picture: choose one, or drop it here (pictures dropped anywhere on the page work too). */
const pictureTool = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: model.drop.id,
    model: model.drop,
    view: FileDrop.view,
    viewInputs: {
      accept: pictureTypes,
      multiple: true,
      toView: (attributes) =>
        h.label(
          [...attributes.root, ...styled(h, styles.tool())],
          [photoIcon(h), format(locale, 'board.addPicture', {}), h.input(attributes.input)],
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
      actionButton(
        {
          label: format(locale, 'board.saveLook', {}),
          leading: addIcon(h),
          style: primaryAction(),
          onClick: Message.ClickedSaveLook(),
          isDisabled: LookSave.guards.Saving(model.look),
        },
        h,
      ),
    ],
  )

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
      h.Attribute('maxlength', '140'),
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

const itemActions = (item: BoardItem, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('toolbar'), h.AriaLabel(format(locale, 'board.selected', {})), ...styled(h, styles.selectionRow())],
    [
      tool(format(locale, 'board.flip', {}), flipIcon(h), Message.ClickedFlip({ id: item.id }), false, h),
      tool(format(locale, 'board.duplicate', {}), copyIcon(h), Message.ClickedDuplicate({ id: item.id }), false, h),
      tool(format(locale, 'board.forward', {}), forwardIcon(h), Message.ClickedForward({ id: item.id }), false, h),
      tool(format(locale, 'board.backward', {}), backwardIcon(h), Message.ClickedBackward({ id: item.id }), false, h),
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

/** The selected item's actions, and a text label's words and style; with nothing selected, the paper. */
export const selectionView = (model: Model, paper: Paper, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Option.match(
    Option.flatMap(model.maybeSelectedId, (id) => findItem(model.items, id)),
    {
      onNone: () => h.div(styled(h, styles.selection()), [paperChoice(paper, locale, h)]),
      onSome: (item) =>
        h.div(styled(h, styles.selection()), [
          itemActions(item, locale, h),
          Schema.is(TextItem)(item) ? textEditor(item, locale, h) : h.empty,
        ]),
    },
  )
