import { languages } from '@styld/i18n'
import { Schema } from 'effect'

/** A language Styld is written in: the catalogs' list (`@styld/i18n`), as the contract decodes it. */
export const Language = Schema.Literals(languages)
export type Language = typeof Language.Type
