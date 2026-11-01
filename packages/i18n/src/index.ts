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

type Catalog = Readonly<Record<MessageKey, string>>

/** The catalog a locale reads from: the pseudo-locales are English underneath. */
export const languageOf = (locale: Locale): Language => (locale === 'sl' ? 'sl' : 'en')

const catalogs = new Map<Language, Catalog>()

/** Make a language's messages available. Servers and tests provide every language at start
 * (`@styld/i18n/all`); the browser loads only the one its page shows (`loadCatalog`). */
export const provideCatalog = (language: Language, catalog: Catalog): void => {
  catalogs.set(language, catalog)
}

/** Load a language's messages on demand: the page's language before hydrating, another one before
 * switching to it. */
export const loadCatalog = async (locale: Locale): Promise<void> => {
  const language = languageOf(locale)
  if (catalogs.has(language)) return
  const { catalog } = language === 'sl' ? await import('./catalog-sl.ts') : await import('./catalog-en.ts')
  provideCatalog(language, catalog)
}

const catalogFor = (locale: Locale): Catalog => {
  const catalog = catalogs.get(languageOf(locale))
  // Formatting before the language is loaded is a wiring defect, not a state the page can show.
  if (catalog === undefined) throw new Error(`The ${languageOf(locale)} catalog is not loaded`)
  return catalog
}

const formatterFor = (locale: Locale, key: MessageKey): IntlMessageFormat => {
  const cacheKey = `${locale}:${key}`
  const cached = formatters.get(cacheKey)
  if (cached !== undefined) return cached
  const source = new IntlMessageFormat(catalogFor(locale)[key], languageOf(locale))
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
