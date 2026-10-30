import type { Tone } from '@styld/protocol'
import type { Html, HtmlBuilder } from 'foldkit/html'
import * as styles from './Avatar.styles.ts'
import { styled } from './Styled.ts'

/** Up to two initials from a name: "Nika Kovač" is NK. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

/** A person's initials on their tone. The name beside it carries the meaning, so the avatar is hidden from
 * assistive technology. */
export const avatar = <Message>(
  name: string,
  tone: Tone,
  size: 'small' | 'medium' | 'large',
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [h.AriaHidden(true), h.DataAttribute('tone', tone), h.DataAttribute('size', size), ...styled(h, styles.avatar())],
    [initials(name)],
  )
