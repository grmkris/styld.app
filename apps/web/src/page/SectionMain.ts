import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { Option } from 'effect'
import { askRouter, boardsRouter, looksRouter, photosRouter, tryOnRouter } from '../route.ts'
import { searchIcon } from '../Icon.ts'
import { round } from './PageBar.styles.ts'
import { styled } from '../Styled.ts'
import { addPiecesAction, pageTitle } from './PageHead.ts'
import * as styles from './SectionMain.styles.ts'

/** The Lab's pages (owner, 2026-11-03, T-08): Wardrobe holds the ingredients, the Lab is where they are tried out. */
export type LabTab = 'boards' | 'gallery' | 'looks' | 'tryOn'

const labTabs = [
  { tab: 'boards', href: boardsRouter({}), label: 'nav.boards' },
  { tab: 'gallery', href: photosRouter({}), label: 'wardrobe.tabGallery' },
  { tab: 'looks', href: looksRouter({}), label: 'looks.title' },
  { tab: 'tryOn', href: tryOnRouter({}), label: 'tryOn.title' },
] as const

const labNav = <Message>(current: LabTab, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.AriaLabel(format(locale, 'lab.title', {})), ...styled(h, styles.tabs())],
    labTabs.map(({ tab, href, label }) =>
      h.a(
        [h.Href(href), ...(current === tab ? [h.AriaCurrent('page')] : []), ...styled(h, styles.tab())],
        [format(locale, label, {})],
      ),
    ),
  )

const sectionMain = <Message>(
  page: Styles.Attributes,
  head: ReadonlyArray<Html>,
  content: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html => h.main([h.Id('main'), ...styled(h, page)], [h.div(styled(h, styles.head()), head), ...content])

/** The Wardrobe's page: its title, search and Add clothes, then the pieces. */
export const wardrobeMain = <Message>(
  page: Styles.Attributes,
  content: ReadonlyArray<Html>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  sectionMain(
    page,
    [
      pageTitle(format(locale, 'wardrobe.title', {}), h),
      h.div(styled(h, styles.actions()), [
        h.a(
          [
            h.Href(askRouter({ q: Option.none() })),
            h.AriaLabel(format(locale, 'ask.searchLabel', {})),
            ...styled(h, round()),
          ],
          [searchIcon(h)],
        ),
        addPiecesAction(locale, h),
      ]),
    ],
    content,
    h,
  )

/** A Lab page: the Lab's title and the page's own action, its tabs under them on a phone and between them on a wide
 * screen (Gallery `wardrobe-desktop.html` › `.pg-h.d.row`), then what the tab shows. */
export const labMain = <Message>(
  current: LabTab,
  page: Styles.Attributes,
  maybeAction: Option.Option<Html>,
  content: ReadonlyArray<Html>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  sectionMain(
    page,
    [
      pageTitle(format(locale, 'lab.title', {}), h),
      labNav(current, locale, h),
      h.div(styled(h, styles.actions()), Option.toArray(maybeAction)),
    ],
    content,
    h,
  )
