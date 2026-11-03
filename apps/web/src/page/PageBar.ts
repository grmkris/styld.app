import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { backIcon } from '../Icon.ts'
import { photosRouter, wardrobeRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import { cx } from 'zyzz'
import { barStart, round } from './PageBar.styles.ts'

export const backTo = <Message>(href: string, label: string, h: HtmlBuilder<Message>): Html =>
  h.a([h.Href(href), h.AriaLabel(label), ...styled(h, cx(round(), barStart()))], [backIcon(h)])

/** The round link back to the wardrobe at the top of a wardrobe page. */
export const backToWardrobe = <Message>(locale: Locale, h: HtmlBuilder<Message>, href = wardrobeRouter({})): Html =>
  h.a(
    [h.Href(href), h.AriaLabel(format(locale, 'wardrobe.backToWardrobe', {})), ...styled(h, cx(round(), barStart()))],
    [backIcon(h)],
  )

/** The round link back to My Gallery at the top of a photo's page. */
export const backToGallery = <Message>(locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(photosRouter({})), h.AriaLabel(format(locale, 'photos.back', {})), ...styled(h, cx(round(), barStart()))],
    [backIcon(h)],
  )
