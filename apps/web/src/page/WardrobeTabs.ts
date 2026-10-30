import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { looksRouter, wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import * as styles from './WardrobeTabs.styles.ts'

/** Wardrobe's two tabs: your pieces, and the looks made from them (Gallery 2). */
export const wardrobeTabs = <Message>(current: 'pieces' | 'looks', locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.AriaLabel(format(locale, 'wardrobe.title', {})), ...styled(h, styles.tabs())],
    [
      h.a(
        [
          h.Href(wardrobeRouter({})),
          ...(current === 'pieces' ? [h.AriaCurrent('page')] : []),
          ...styled(h, styles.tab()),
        ],
        [format(locale, 'wardrobe.tabPieces', {})],
      ),
      h.a(
        [h.Href(looksRouter({})), ...(current === 'looks' ? [h.AriaCurrent('page')] : []), ...styled(h, styles.tab())],
        [format(locale, 'looks.title', {})],
      ),
    ],
  )
