import { Button } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { styled } from './Styled.ts'

type ActionButtonConfig<Message> = Omit<Button.ViewConfig<Message>, 'toView'> &
  Readonly<{ label: string; style: Styles.Attributes; leading?: Html; describedBy?: string; pressed?: boolean }>

/** A text button through Foldkit UI's headless Button; a toggle says whether it is pressed. A disabled action is `aria-disabled`
 * and drops its click, so a pending button keeps focus while it waits (DESIGN.md › Controls). */
export const actionButton = <Message>(
  { label, style, leading, describedBy, pressed, ...button }: ActionButtonConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      ...button,
      toView: (attributes) =>
        h.button(
          [
            ...attributes.button,
            ...(describedBy === undefined ? [] : [h.AriaDescribedBy(describedBy)]),
            ...(pressed === undefined ? [] : [h.AriaPressed(pressed ? 'true' : 'false')]),
            ...styled(h, style),
          ],
          [leading ?? h.empty, label],
        ),
    },
    h,
  )
