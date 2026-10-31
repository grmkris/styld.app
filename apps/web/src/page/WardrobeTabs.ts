import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { looksRouter, wardrobeRouter, wishlistRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { addPiecesAction, pageHead, pageTitle } from './PageHead.ts'
import * as styles from './WardrobeTabs.styles.ts'

type WardrobeTab = 'pieces' | 'looks' | 'wishlist'

const tabs = [
  { tab: 'pieces', href: wardrobeRouter({}), label: 'wardrobe.tabPieces' },
  { tab: 'looks', href: looksRouter({}), label: 'looks.title' },
  { tab: 'wishlist', href: wishlistRouter({}), label: 'wardrobe.wishlist' },
] as const

/** Wardrobe's tabs: your pieces, the looks made from them, and what you want one like (Gallery 2). */
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

/** A Wardrobe tab's page: its title with Add pieces, the tabs, then what the tab shows. */
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
      pageHead(pageTitle(format(locale, 'wardrobe.title', {}), h), Option.some(addPiecesAction(locale, h)), h),
      wardrobeTabs(current, locale, h),
      ...content,
    ],
  )
