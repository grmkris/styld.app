import { catalog as en } from './catalog-en.ts'
import { catalog as sl } from './catalog-sl.ts'
import { provideCatalog } from './index.ts'
import { catalog as legalEn } from './legal-en.ts'
import { catalog as legalSl } from './legal-sl.ts'

/** Provide every language, the legal pages' words included. Servers and tests call it once at start; the browser
 * does not, so its bundle carries only the language it loads. */
export const provideAllCatalogs = (): void => {
  provideCatalog('en', { ...en, ...legalEn })
  provideCatalog('sl', { ...sl, ...legalSl })
}
