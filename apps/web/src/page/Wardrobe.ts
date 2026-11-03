import * as Crypto from 'effect/Crypto'
import { Dialog } from '@foldkit/ui'
import { Colour, GarmentGroup, groupOf, Occasion, Piece, PieceType, Season } from '@styld/protocol'
import { Array, Option, Order, Schema } from 'effect'
import type { Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'
import { StyldClient } from '../StyldClient.ts'
import { browseColours, BrowseQuery } from '../WardrobeBrowse.ts'

// The wardrobe tab: the person's pieces (the app's, read once for every page that shows them), browsed as a shop is
// (owner, 2026-11-03, T-07): the groups as cards, then the chosen group's types as cards, then the chosen type's
// pieces, narrowed by the filter sheet. Each step down is a link, so the phone's Back goes a step up.

// MODEL

/** What else narrows the grid, from the filter sheet: any of these colours, a season, an occasion, a brand. */
export const Filters = Schema.Struct({
  colours: Schema.Array(Colour),
  season: Schema.Option(Season),
  occasion: Schema.Option(Occasion),
  brand: Schema.Option(Schema.String),
})
export type Filters = typeof Filters.Type

const noFilters: Filters = { colours: [], season: Option.none(), occasion: Option.none(), brand: Option.none() }

/** How many filters are set, for the button that opens them. */
export const filterCount = (filters: Filters) =>
  filters.colours.length +
  Number(Option.isSome(filters.season)) +
  Number(Option.isSome(filters.occasion)) +
  Number(Option.isSome(filters.brand))

/** The pieces the browsing and the filters leave: in the group and type chosen, of any chosen colour, worn in the
 * chosen season (an all-year piece is worn in any), for the chosen occasion and of the chosen brand. */
export const shownPieces = (pieces: ReadonlyArray<Piece>, model: Model): ReadonlyArray<Piece> =>
  Array.filter(
    pieces,
    (piece) =>
      Option.match(model.group, { onNone: () => true, onSome: (group) => groupOf(piece.type) === group }) &&
      Option.match(model.type, { onNone: () => true, onSome: (type) => piece.type === type }) &&
      (model.filters.colours.length === 0 || piece.colours.some((colour) => model.filters.colours.includes(colour))) &&
      Option.match(model.filters.season, {
        onNone: () => true,
        onSome: (season) => piece.season === season || piece.season === 'allYear',
      }) &&
      Option.match(model.filters.occasion, {
        onNone: () => true,
        onSome: (occasion) => piece.occasions.includes(occasion),
      }) &&
      Option.match(model.filters.brand, { onNone: () => true, onSome: (brand) => piece.brand === brand }),
  )

/** The brands the person has written on their pieces, in order. */
export const brandsOf = (pieces: ReadonlyArray<Piece>): ReadonlyArray<string> =>
  Array.sort(Array.dedupe(pieces.flatMap((piece) => (piece.brand === null ? [] : [piece.brand]))), Order.String)

/** The newest of some pieces, whose picture stands for them on a category's card (owner, 2026-11-03). */
export const newestOf = (pieces: ReadonlyArray<Piece>): Option.Option<Piece> =>
  Array.reduce(pieces, Option.none<Piece>(), (newest, piece) =>
    Option.match(newest, {
      onNone: () => Option.some(piece),
      onSome: (kept) => (piece.createdAt > kept.createdAt ? Option.some(piece) : newest),
    }),
  )

export const Model = Schema.Struct({
  /** The group being browsed, then one of its types, whose pieces show; none shows the groups. */
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  filters: Filters,
  filterSheet: Dialog.Model,
})
export type Model = typeof Model.Type

export const init = (query: BrowseQuery = {}): Model => ({
  ...browsing(query),
  filterSheet: Dialog.init({ id: 'wardrobe-filters', isAnimated: true }),
})

const browsing = (query: BrowseQuery) => ({
  group: Option.fromNullishOr(query.group),
  type: Option.filter(
    Option.fromNullishOr(query.type),
    (type) => query.group === undefined || groupOf(type) === query.group,
  ),
  filters: {
    colours: Option.getOrElse(browseColours(query.colours?.split(',') ?? []), () => []),
    season: Option.fromNullishOr(query.season),
    occasion: Option.fromNullishOr(query.occasion),
    brand: Option.fromNullishOr(query.brand),
  },
})

export const restore = (model: Model, query: BrowseQuery): Model => {
  const restored = browsing(query)
  return modifyFields(model, {
    group: () => restored.group,
    type: () => restored.type,
    filters: () => restored.filters,
  })
}

export const queryOf = (model: Model): BrowseQuery => ({
  ...Option.match(model.group, { onNone: () => ({}), onSome: (group) => ({ group }) }),
  ...Option.match(model.type, { onNone: () => ({}), onSome: (type) => ({ type }) }),
  ...(model.filters.colours.length === 0 ? {} : { colours: model.filters.colours.join(',') }),
  ...Option.match(model.filters.season, { onNone: () => ({}), onSome: (season) => ({ season }) }),
  ...Option.match(model.filters.occasion, { onNone: () => ({}), onSome: (occasion) => ({ occasion }) }),
  ...Option.match(model.filters.brand, { onNone: () => ({}), onSome: (brand) => ({ brand }) }),
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedFilters: {},
  GotFilterSheetMessage: { message: Dialog.Message },
  ToggledFilterColour: { colour: Colour },
  ChoseFilterSeason: { season: Season },
  ChoseFilterOccasion: { occasion: Occasion },
  ChoseFilterBrand: { brand: Schema.String },
  ClickedClearFilters: {},
  ClickedShowPieces: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type

/** The pieces are the app's: the page asks for them again after a failure. */
export const OutMessage = defineMessageUnion({ RequestedPieces: {}, ChangedBrowse: { query: BrowseQuery } })
export type OutMessage = typeof OutMessage.Type

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

const filterSheet = sheetFolds<Model, Message>({
  read: (model) => model.filterSheet,
  write: (model, nextFilterSheet) => modifyFields(model, { filterSheet: () => nextFilterSheet }),
  toParentMessage: (message) => Message.GotFilterSheetMessage({ message }),
})
const foldFilterSheet = filterSheet.update
const openFilterSheet = filterSheet.open
const closeFilterSheet = filterSheet.close

/** Choosing the chosen one again clears it. */
const chosenAgain = <A>(value: A, chosen: Option.Option<A>): Option.Option<A> =>
  Option.contains(chosen, value) ? Option.none() : Option.some(value)

const browsed = (model: Model): UpdateReturn => ({
  model,
  outMessage: OutMessage.ChangedBrowse({ query: queryOf(model) }),
})

const filtered = (model: Model, change: (filters: Filters) => Filters): UpdateReturn =>
  browsed(modifyFields(model, { filters: change }))

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedFilters: () => openFilterSheet(model),
    GotFilterSheetMessage: ({ message: sheetMessage }) => foldFilterSheet(model, sheetMessage),
    ToggledFilterColour: ({ colour }) =>
      filtered(model, (filters) =>
        modifyFields(filters, {
          colours: (colours) =>
            colours.includes(colour) ? colours.filter((each) => each !== colour) : [...colours, colour],
        }),
      ),
    ChoseFilterSeason: ({ season }) =>
      filtered(model, (filters) => modifyFields(filters, { season: (chosen) => chosenAgain(season, chosen) })),
    ChoseFilterOccasion: ({ occasion }) =>
      filtered(model, (filters) => modifyFields(filters, { occasion: (chosen) => chosenAgain(occasion, chosen) })),
    ChoseFilterBrand: ({ brand }) =>
      filtered(model, (filters) => modifyFields(filters, { brand: (chosen) => chosenAgain(brand, chosen) })),
    ClickedClearFilters: () => filtered(model, () => noFilters),
    ClickedShowPieces: () => closeFilterSheet(model),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
  })
