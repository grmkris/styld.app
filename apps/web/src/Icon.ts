import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import { loaderIcon } from './Icon.styles.ts'
import { CircleNotchRegular } from './PhosphorIcons.ts'
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
