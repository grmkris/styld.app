import { Brand, CategoryName, Colour, GarmentGroup, groupOf, Occasion, PieceType, Season } from '@styld/protocol'
import { Array, Equal, Option, Schema, SchemaTransformation } from 'effect'
import { modifyFields } from 'foldkit/struct'

// What the wardrobe shows, as its address says it: the group, the type and the person's own category browsed, and the
// filters on a type's pieces. The address is the only copy (Foldkit's query-sync): the page reads it and a change
// replaces it. Each parameter is read leniently, as anyone may write or keep an old link: a value that is not one of
// ours (a type renamed since, `?rainproof=no`) is left out instead of turning the page into Not found.

// MODEL

/** What else narrows a type's pieces: any of these colours, a season, made for rain, an occasion, a brand. */
export const Filters = Schema.Struct({
  colours: Schema.Array(Colour),
  season: Schema.Option(Season),
  rainproof: Schema.Boolean,
  occasion: Schema.Option(Occasion),
  brand: Schema.Option(Brand),
})
export type Filters = typeof Filters.Type

export const noFilters: Filters = {
  colours: [],
  season: Option.none(),
  rainproof: false,
  occasion: Option.none(),
  brand: Option.none(),
}

/** The level browsed (none for the groups, a group for its types, a type for its pieces, maybe one of the person's
 * own categories under it) and the filters on a type's pieces. */
export const Browse = Schema.Struct({
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  category: Schema.Option(CategoryName),
  filters: Filters,
})
export type Browse = typeof Browse.Type

/** The wardrobe's groups, nothing chosen or filtered. */
export const unfiltered: Browse = {
  group: Option.none(),
  type: Option.none(),
  category: Option.none(),
  filters: noFilters,
}

/** A group's types. */
export const browseGroup = (group: GarmentGroup): Browse =>
  modifyFields(unfiltered, { group: () => Option.some(group) })

/** A type's pieces, under its own group, maybe of one of the person's categories. */
export const browseType = (type: PieceType, maybeCategory: Option.Option<string> = Option.none()): Browse =>
  modifyFields(unfiltered, {
    group: () => Option.some(groupOf(type)),
    type: () => Option.some(type),
    category: () => maybeCategory,
  })

/** Whether two browses are on the same level: the same group, type and category, whatever their filters. */
export const sameLevel = (left: Browse, right: Browse) =>
  Equal.equals(left.group, right.group) &&
  Equal.equals(left.type, right.type) &&
  Equal.equals(left.category, right.category)

/** A browse as the page can show it: a type belongs to its group, and a category and filters belong to a type (the
 * filter sheet is a type's), so whatever does not fit is left out. */
export const normalised = (browse: Browse): Browse => {
  const type = Option.filter(browse.type, (each) => Option.contains(browse.group, groupOf(each)))
  return Option.isNone(type)
    ? modifyFields(unfiltered, { group: () => browse.group })
    : modifyFields(browse, { filters: (filters) => modifyFields(filters, { colours: Array.dedupe }) })
}

// ADDRESS

/** A parameter that is one of the schema's values, or absent: anything else reads as absent (query-sync's
 * `optionFromValidParam`). */
const fromValidParam = <A extends string>(schema: Schema.Codec<A, A>) => {
  const decode = Schema.decodeUnknownOption(schema)
  return Schema.OptionFromOptional(Schema.String).pipe(
    Schema.decodeTo(
      Schema.Option(schema),
      SchemaTransformation.transform({
        decode: (maybeRaw: Option.Option<string>): Option.Option<A> => Option.flatMap(maybeRaw, decode),
        encode: (maybeValue: Option.Option<A>): Option.Option<string> => maybeValue,
      }),
    ),
  )
}

const decodeColour = Schema.decodeUnknownOption(Colour)

/** The colours, comma separated: the ones we know, each once; none prints no parameter. */
const coloursParam = Schema.OptionFromOptional(Schema.String).pipe(
  Schema.decodeTo(
    Schema.Array(Colour),
    SchemaTransformation.transform({
      decode: (maybeRaw: Option.Option<string>): ReadonlyArray<Colour> =>
        Option.match(maybeRaw, {
          onNone: () => [],
          onSome: (raw) => Array.dedupe(Array.getSomes(raw.split(',').map((each) => decodeColour(each)))),
        }),
      encode: (colours: ReadonlyArray<Colour>): Option.Option<string> =>
        Array.isReadonlyArrayEmpty(colours) ? Option.none() : Option.some(colours.join(',')),
    }),
  ),
)

/** A switch that is on only as `yes`, and prints nothing when off. */
const flagParam = Schema.OptionFromOptional(Schema.String).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (maybeRaw: Option.Option<string>): boolean => Option.contains(maybeRaw, 'yes'),
      encode: (on: boolean): Option.Option<string> => (on ? Option.some('yes') : Option.none()),
    }),
  ),
)

const BrowseParams = Schema.Struct({
  group: fromValidParam(GarmentGroup),
  type: fromValidParam(PieceType),
  /** One of the person's own categories under the type (T-12). */
  category: fromValidParam(CategoryName),
  colours: coloursParam,
  season: fromValidParam(Season),
  rainproof: flagParam,
  occasion: fromValidParam(Occasion),
  brand: fromValidParam(Brand),
})
type BrowseParams = typeof BrowseParams.Type

const browseOf = ({ group, type, category, ...filters }: BrowseParams): Browse =>
  normalised({ group, type, category, filters })

const paramsOf = (browse: Browse): BrowseParams => {
  const { group, type, category, filters } = normalised(browse)
  return { group, type, category, ...filters }
}

/** The wardrobe's query: its parameters, read leniently and made to fit together, as one browse. */
export const BrowseQuery = BrowseParams.pipe(
  Schema.decodeTo(
    Schema.Struct({ browse: Browse }),
    SchemaTransformation.transform({
      decode: (params: BrowseParams) => ({ browse: browseOf(params) }),
      encode: ({ browse }: { readonly browse: Browse }) => paramsOf(browse),
    }),
  ),
)
