import { Button } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { styled } from './Styled.ts'

type ActionButtonConfig<Message> = Omit<Button.ViewConfig<Message>, 'toView'> &
  Readonly<{ label: string; style: Styles.Attributes; leading?: Html }>

/** A text button through Foldkit UI's headless Button. A disabled action is `aria-disabled`
 * and drops its click, so a pending button keeps focus while it waits (DESIGN.md › Controls). */
export const actionButton = <Message>(
  { label, style, leading, ...button }: ActionButtonConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      ...button,
      toView: (attributes) => h.button([...attributes.button, ...styled(h, style)], [leading ?? h.empty, label]),
    },
    h,
  )
