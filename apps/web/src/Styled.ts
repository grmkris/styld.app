import type { HtmlBuilder, TextareaAttribute } from 'foldkit/html'
import type { Html } from 'zyzz/runtime'

/** Foldkit attributes for an applied zyzz style: its classes, inline declarations
 * and recipe `data-*` attributes. Inline declarations need a `style-src-attr`
 * allowance in the edge CSP, so static styles are preferred. */
export const styled = <Message>(
  h: HtmlBuilder<Message>,
  attributes: Html.Attributes,
): Array<TextareaAttribute<Message>> => {
  const result: Array<TextareaAttribute<Message>> = [h.Class(attributes.class)]
  if (attributes.style !== undefined) result.push(h.Attribute('style', attributes.style))
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('data-') && value !== undefined) result.push(h.DataAttribute(name.slice('data-'.length), value))
  }
  return result
}
