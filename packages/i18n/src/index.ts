import { IntlMessageFormat } from 'intl-messageformat'

import type { MessageKey, MessageValues } from './generated.ts'
import { pseudoMessage } from './pseudo.ts'

export type { MessageKey, MessageValues, RichTextValue } from './generated.ts'
export { catalogVersion } from './generated.ts'
/** The languages Styld is written in, each a reviewed catalog. */
export const languages = ['en', 'sl'] as const
export type Language = (typeof languages)[number]

/** A language, or a pseudo-locale that tests text expansion and right-to-left layout on English. */
export type Locale = Language | 'en-XA' | 'ar-XB'

const defaultLocale: Locale = 'en'
const formatterLimit = 4096
const formatters = new Map<string, IntlMessageFormat>()

/** A language's messages: every key once it is whole; the browser's lacks the legal pages' words until a page asks. */
type Catalog = Readonly<Partial<Record<MessageKey, string>>>

/** The catalog a locale reads from: the pseudo-locales are English underneath. */
export const languageOf = (locale: Locale): Language => (locale === 'sl' ? 'sl' : 'en')

const catalogs = new Map<Language, Catalog>()
/** The languages that hold every key, the legal pages' words included. */
const whole = new Set<Language>()
let withLegal = false

/** Make a language's messages available. Servers and tests provide every language at start
 * (`@styld/i18n/all`); the browser loads only the one its page shows (`loadCatalog`). */
export const provideCatalog = (language: Language, catalog: Readonly<Record<MessageKey, string>>): void => {
  catalogs.set(language, catalog)
  whole.add(language)
}

/** Load a language's messages on demand: the page's language before hydrating, another one before switching to it.
 * The privacy policy and the terms ask for their own long words too (`legal`), which no other page carries; once a
 * page has asked, every language loaded after it brings them, so switching language there finds them. */
export const loadCatalog = async (locale: Locale, options: Readonly<{ legal?: boolean }> = {}): Promise<void> => {
  const language = languageOf(locale)
  withLegal = withLegal || options.legal === true
  if (whole.has(language) || (catalogs.has(language) && !withLegal)) return
  const [{ catalog: main }, legal] = await Promise.all([
    language === 'sl' ? import('./catalog-sl.ts') : import('./catalog-en.ts'),
    withLegal ? (language === 'sl' ? import('./legal-sl.ts') : import('./legal-en.ts')) : undefined,
  ])
  catalogs.set(language, { ...legal?.catalog, ...main })
  if (legal !== undefined) whole.add(language)
}

const messageOf = (locale: Locale, key: MessageKey): string => {
  const message = catalogs.get(languageOf(locale))?.[key]
  // Formatting before the language (or the legal pages' words) is loaded is a wiring defect, not a state the page
  // can show.
  if (message === undefined) throw new Error(`${key} is not loaded in ${languageOf(locale)}`)
  return message
}

const formatterFor = (locale: Locale, key: MessageKey): IntlMessageFormat => {
  const cacheKey = `${locale}:${key}`
  const cached = formatters.get(cacheKey)
  if (cached !== undefined) return cached
  const source = new IntlMessageFormat(messageOf(locale, key), languageOf(locale))
  const formatter =
    locale === 'en-XA' || locale === 'ar-XB'
      ? new IntlMessageFormat(pseudoMessage(source.getAst(), locale), 'en')
      : source
  if (formatters.size >= formatterLimit) {
    const oldest = formatters.keys().next().value
    if (oldest !== undefined) formatters.delete(oldest)
  }
  formatters.set(cacheKey, formatter)
  return formatter
}

export const normalizeLocale = (input: string | undefined): Locale => {
  if (input === 'en-XA' || input === 'ar-XB') return input
  if (/^sl(?:-[a-z0-9]{2,8})*$/i.test(input ?? '')) return 'sl'
  return defaultLocale
}

export const direction = (locale: Locale): 'ltr' | 'rtl' => (locale === 'ar-XB' ? 'rtl' : 'ltr')

export const formatRich = <K extends MessageKey, T = string>(
  locale: Locale,
  key: K,
  values: MessageValues<K, T>,
): string | T | (string | T)[] => {
  const rendered = formatterFor(locale, key).format<T>(values)
  return rendered
}

export const format = <K extends MessageKey>(locale: Locale, key: K, values: MessageValues<K>): string => {
  const rendered = formatRich(locale, key, values)
  return typeof rendered === 'string' ? rendered : rendered.join('')
}

export const text = <K extends MessageKey>(key: K, values: MessageValues<K>): string => {
  return format(defaultLocale, key, values)
}
