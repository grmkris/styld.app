import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { backIcon } from '../Icon.ts'
import { wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { cx } from 'zyzz'
import { barStart, round } from './PageBar.styles.ts'

/** The round link back to the wardrobe at the top of a wardrobe page. */
export const backToWardrobe = <Message>(locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [
      h.Href(wardrobeRouter({})),
      h.AriaLabel(format(locale, 'wardrobe.backToWardrobe', {})),
      ...styled(h, cx(round(), barStart())),
    ],
    [backIcon(h)],
  )
