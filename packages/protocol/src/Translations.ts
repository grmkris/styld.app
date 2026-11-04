import { Schema } from 'effect'
import { BoardName, LabelText } from './Board.ts'
import { Bio, ProfileName } from './Profile.ts'

// The same board or profile in another language (owner, 4 November 2026). The board's or profile's own text is the
// original; a translation is shown in its language while the original it translated is unchanged, and the original is
// shown once the owner changes it. Every translation is stored for review; pending copy is still shown.

/** The languages a translation can be in: every language Styld is written in but the originals' English. */
export const TranslatedLocale = Schema.Literals(['sl'])
export type TranslatedLocale = typeof TranslatedLocale.Type

/** Whether Eva has reviewed a translation; pending ones are shown too, so she can find them. */
export const ReviewState = Schema.Literals(['pending', 'approved'])
export type ReviewState = typeof ReviewState.Type

/** A board's name and its table's labels in another language, the labels by the table item they translate. */
export const BoardTranslation = Schema.Struct({
  locale: TranslatedLocale,
  name: BoardName,
  labels: Schema.Record(Schema.String, LabelText),
  review: ReviewState,
})
export type BoardTranslation = typeof BoardTranslation.Type

/** A profile's name and bio in another language. */
export const ProfileTranslation = Schema.Struct({
  locale: TranslatedLocale,
  name: ProfileName,
  bio: Bio,
  review: ReviewState,
})
export type ProfileTranslation = typeof ProfileTranslation.Type
