import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { looksRouter, photosRouter, wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { addPiecesAction, pageTitle } from './PageHead.ts'
import * as styles from './WardrobeTabs.styles.ts'

type WardrobeTab = 'pieces' | 'looks' | 'gallery'

const tabs = [
  { tab: 'pieces', href: wardrobeRouter({}), label: 'wardrobe.tabPieces' },
  { tab: 'looks', href: looksRouter({}), label: 'looks.title' },
  { tab: 'gallery', href: photosRouter({}), label: 'wardrobe.tabGallery' },
] as const

/** Wardrobe's tabs: your pieces, the looks made from them, and your outfit photos (Gallery 2; owner, 2026-10-31). */
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
