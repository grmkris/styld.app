import { Brand, Colour, GarmentGroup, PieceType, Occasion, Season } from '@styld/protocol'
import { Schema } from 'effect'

export const BrowseQuery = Schema.Struct({
  group: Schema.optionalKey(GarmentGroup),
  type: Schema.optionalKey(PieceType),
  colours: Schema.optionalKey(Schema.String),
  season: Schema.optionalKey(Season),
  rainproof: Schema.optionalKey(Schema.Literal('yes')),
  occasion: Schema.optionalKey(Occasion),
  brand: Schema.optionalKey(Brand),
})
export type BrowseQuery = typeof BrowseQuery.Type

export const browseColours = Schema.decodeUnknownOption(Schema.Array(Colour).check(Schema.isUnique()))
