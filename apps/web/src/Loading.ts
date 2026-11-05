import { format, type Locale } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Html as Styles } from 'zyzz/runtime'
import { styled } from './Styled.ts'
import { visuallyHidden } from './VisuallyHidden.styles.ts'

// A page's shape while it loads (DESIGN.md › States): what is loading, said once for assistive technology, and the
// placeholders the eye sees, which assistive technology skips.

/** What is loading, for assistive technology only. */
export const loadingStatus = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Role('status'), ...styled(h, visuallyHidden())], [text])

type Placeholders = {
  readonly list: Styles.Attributes
  readonly slots: ReadonlyArray<string>
  readonly item?: Styles.Attributes
  readonly content: ReadonlyArray<Html>
}

/** A list of placeholders in the list's own layout, one per slot, each item styled as `item` and holding `content`. */
export const placeholderList = <Message>(config: Placeholders, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, config.list)],
    config.slots.map((slot) =>
      h.keyed('li')(slot, config.item === undefined ? [] : styled(h, config.item), [...config.content]),
    ),
  )

/** A list page while it loads: "Loading" for assistive technology, and its placeholders. */
export const loadingList = <Message>(
  locale: Locale,
  config: Placeholders,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [loadingStatus(format(locale, 'common.loading', {}), h), placeholderList(config, h)]
