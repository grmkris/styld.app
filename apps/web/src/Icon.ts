import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import { controlIcon, loaderIcon, tabIcon } from './Icon.styles.ts'
import {
  ArrowClockwiseRegular,
  ArrowCounterClockwiseRegular,
  ArrowDownRegular,
  ArrowsLeftRightRegular,
  ArrowUpRegular,
  ChatCircleRegular,
  ClipboardTextRegular,
  CopyRegular,
  MagnifyingGlassLight,
  MagnifyingGlassRegular,
  ShuffleRegular,
  SquaresFourLight,
  SquaresFourRegular,
  TextTRegular,
  XRegular,
  ArrowsClockwiseRegular,
  CameraRegular,
  CaretLeftRegular,
  CheckRegular,
  CircleNotchRegular,
  HouseLight,
  ImageRegular,
  PencilSimpleRegular,
  PlusRegular,
  TShirtLight,
  TrashRegular,
  VideoCameraRegular,
} from './PhosphorIcons.ts'
import { styled } from './Styled.ts'

/** A Phosphor icon in the current text colour, hidden from assistive technology: the text or
 * control label beside it carries the meaning (DESIGN.md › Icons). Its 1em size attributes hold it
 * to the text if styles fail to load; zyzz styles set the real size. */
const phosphor = <Message>(
  path: string,
  attributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.svg(
    [
      h.ViewBox('0 0 256 256'),
      h.Width('1em'),
      h.Height('1em'),
      h.Fill('currentColor'),
      h.AriaHidden(true),
      ...attributes,
    ],
    [h.path([h.D(path)])],
  )

/** The turning loader beside pending work; a `role="status"` or the control's label says what is pending. */
export const loader = <Message>(h: HtmlBuilder<Message>): Html =>
  phosphor(CircleNotchRegular, [h.DataAttribute('loader', ''), ...styled(h, loaderIcon())], h)

const control =
  (path: string) =>
  <Message>(h: HtmlBuilder<Message>): Html =>
    phosphor(path, styled(h, controlIcon()), h)

const tab =
  (path: string) =>
  <Message>(h: HtmlBuilder<Message>): Html =>
    phosphor(path, styled(h, tabIcon()), h)

/** 20px control icons in the Regular weight (DESIGN.md › Icons). */
export const backIcon = control(CaretLeftRegular)
export const checkIcon = control(CheckRegular)
export const photoIcon = control(ImageRegular)
export const editIcon = control(PencilSimpleRegular)
export const addIcon = control(PlusRegular)
export const deleteIcon = control(TrashRegular)
export const cameraIcon = control(CameraRegular)
export const videoIcon = control(VideoCameraRegular)
export const retryIcon = control(ArrowsClockwiseRegular)
export const undoIcon = control(ArrowCounterClockwiseRegular)
export const redoIcon = control(ArrowClockwiseRegular)
export const tidyIcon = control(SquaresFourRegular)
export const textIcon = control(TextTRegular)
export const pasteIcon = control(ClipboardTextRegular)
export const flipIcon = control(ArrowsLeftRightRegular)
export const copyIcon = control(CopyRegular)
export const forwardIcon = control(ArrowUpRegular)
export const backwardIcon = control(ArrowDownRegular)
export const spinIcon = control(ShuffleRegular)
export const searchIcon = control(MagnifyingGlassRegular)
export const stylistIcon = control(ChatCircleRegular)
export const closeIcon = control(XRegular)

/** 24px tab icons in the Light weight. */
export const homeTabIcon = tab(HouseLight)
export const wardrobeTabIcon = tab(TShirtLight)
export const askTabIcon = tab(MagnifyingGlassLight)
export const boardsTabIcon = tab(SquaresFourLight)
