import { format, type Locale } from '@styld/i18n'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { primaryAction } from '../Actions.styles.ts'
import { addIcon } from '../Icon.ts'
import { addPiecesRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import * as styles from './PageHead.styles.ts'

/** The top of a tab page (Gallery 2 `.head`): its title, and its one round action or an empty slot of the same
 * size, so the title starts at the same height on every page and nothing moves between them. */
export const pageHead = <Message>(title: Html, maybeAction: Option.Option<Html>, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.head()), [
    title,
    Option.getOrElse(maybeAction, () => h.span([h.AriaHidden(true), ...styled(h, styles.slot())])),
  ])

/** A tab page's title in the shared head. */
export const pageTitle = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.h1(styled(h, styles.title()), [text])

/** The round + that adds pieces, at the top of the wardrobe's tabs. */
export const addPiecesAction = <Message>(locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [
      h.Href(addPiecesRouter({})),
      h.AriaLabel(format(locale, 'capture.addTitle', {})),
      ...styled(h, cx(primaryAction(), styles.roundAction())),
    ],
    [addIcon(h)],
  )
