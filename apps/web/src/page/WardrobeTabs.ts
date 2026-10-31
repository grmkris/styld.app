import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { looksRouter, wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { addPiecesAction, pageTitle } from './PageHead.ts'
import * as styles from './WardrobeTabs.styles.ts'

type WardrobeTab = 'pieces' | 'looks'

const tabs = [
  { tab: 'pieces', href: wardrobeRouter({}), label: 'wardrobe.tabPieces' },
  { tab: 'looks', href: looksRouter({}), label: 'looks.title' },
] as const

/** Wardrobe's tabs: your pieces and the looks made from them (Gallery 2). */
const wardrobeTabs = <Message>(current: WardrobeTab, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.AriaLabel(format(locale, 'wardrobe.title', {})), ...styled(h, styles.tabs())],
    tabs.map(({ tab, href, label }) =>
      h.a(
        [h.Href(href), ...(current === tab ? [h.AriaCurrent('page')] : []), ...styled(h, styles.tab())],
        [format(locale, label, {})],
      ),
    ),
  )

/** A Wardrobe tab's page: its title and Add clothes, the tabs under them on a phone and between them on a wide
 * screen (Gallery `wardrobe-desktop.html` › `.pg-h.d.row`), then what the tab shows. */
export const wardrobeMain = <Message>(
  current: WardrobeTab,
  page: Styles.Attributes,
  content: ReadonlyArray<Html>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [h.Id('main'), ...styled(h, page)],
    [
      h.div(styled(h, styles.head()), [
        pageTitle(format(locale, 'wardrobe.title', {}), h),
        wardrobeTabs(current, locale, h),
        addPiecesAction(locale, h),
      ]),
      ...content,
    ],
  )
