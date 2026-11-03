import { type Piece, type PieceChanges, ShopUrl } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { Details, detailsOf } from './PieceFields.ts'

// A piece's edit form: its values as typed, how its save is going, and the changes it sends.

/** The edit form being filled in, saved, or refused on its last save. */
export const DraftSave = defineTaggedUnion({ Editing: {}, Saving: {}, Failed: {} })
export type DraftSave = typeof DraftSave.Type

/** The edit form's values; nothing reaches the piece until it is saved. */
export const Draft = Schema.Struct({
  name: Schema.String,
  notes: Schema.String,
  details: Details,
  rotation: Schema.Literals([0, 90, 180, 270]),
  brand: Schema.String,
  shopUrl: Schema.String,
  save: DraftSave,
  /** The shop link is not an https address: nothing is sent until it is. */
  shopUrlInvalid: Schema.Boolean,
})
export type Draft = typeof Draft.Type

/** The form as it opens on a piece. */
export const draftOf = (piece: Piece): Draft => ({
  name: piece.name ?? '',
  notes: piece.notes ?? '',
  details: detailsOf(piece),
  rotation: piece.rotation,
  brand: piece.brand ?? '',
  shopUrl: piece.shopUrl ?? '',
  save: DraftSave.Editing(),
  shopUrlInvalid: false,
})

/** Words left empty, spaces aside, are no value. */
const given = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** The saved form, as the API takes it: an empty field is no value, and an attribute left unchosen is cleared. */
export const changesOf = (draft: Draft): PieceChanges => ({
  name: given(draft.name),
  notes: given(draft.notes),
  ...Option.match(draft.details.type, { onNone: () => ({}), onSome: (type) => ({ type }) }),
  colours: draft.details.colours,
  seasons: draft.details.seasons,
  rainproof: draft.details.rainproof,
  occasions: draft.details.occasions,
  pattern: Option.getOrNull(draft.details.pattern),
  brand: given(draft.brand),
  shopUrl: given(draft.shopUrl),
  rotation: draft.rotation,
})

/** Whether a shop link can be sent: none, or an https address. */
export const shopUrlSendable = (shopUrl: string) => shopUrl.trim() === '' || Schema.is(ShopUrl)(shopUrl.trim())
