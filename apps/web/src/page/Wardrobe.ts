import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Dialog } from '@foldkit/ui'
import { Colour, GarmentGroup, groupOf, Occasion, Piece, PieceType, Season } from '@styld/protocol'
import { Array, Effect, Option, Order, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'
import { drawOperationId } from '../OperationIds.ts'
import { StyldClient } from '../StyldClient.ts'
import { browseColours, BrowseQuery } from '../WardrobeBrowse.ts'

// The wardrobe tab: the person's pieces (the app's, read once for every page that shows them), browsed as a shop is
// (owner, 2026-11-03, T-07): the groups as cards, then the chosen group's types as cards, then the chosen type's
// pieces, narrowed by the filter sheet. Each step down is a link, so the phone's Back goes a step up.

// MODEL

/** What else narrows the grid, from the filter sheet: any of these colours, a season, made for rain, an occasion, a
 * brand. */
export const Filters = Schema.Struct({
  colours: Schema.Array(Colour),
  season: Schema.Option(Season),
  rainproof: Schema.Boolean,
  occasion: Schema.Option(Occasion),
  brand: Schema.Option(Schema.String),
})
export type Filters = typeof Filters.Type

const noFilters: Filters = {
  colours: [],
  season: Option.none(),
  rainproof: false,
  occasion: Option.none(),
  brand: Option.none(),
}

/** How many filters are set, for the button that opens them. */
export const filterCount = (filters: Filters) =>
  filters.colours.length +
  Number(Option.isSome(filters.season)) +
  Number(filters.rainproof) +
  Number(Option.isSome(filters.occasion)) +
  Number(Option.isSome(filters.brand))

/** Whether a piece's category is the one asked for (none for none), whatever their case. */
const sameCategory = (category: string | null, asked: string | null) =>
  (category?.toLowerCase() ?? null) === (asked?.toLowerCase() ?? null)

/** The pieces the browsing and the filters leave: in the group and type chosen, of any chosen colour, worn in the
 * chosen season (a piece with no season is worn in any), made for rain when asked, for the chosen occasion and of the
 * chosen brand. */
export const shownPieces = (pieces: ReadonlyArray<Piece>, model: Model): ReadonlyArray<Piece> =>
  Array.filter(
    pieces,
    (piece) =>
      Option.match(model.group, { onNone: () => true, onSome: (group) => groupOf(piece.type) === group }) &&
      Option.match(model.type, { onNone: () => true, onSome: (type) => piece.type === type }) &&
      // Under a type, its pieces of no category of the person's own, or those of the one chosen, whatever its case
      // (a rename that joins a category keeps that one's spelling; T-12).
      (Option.isNone(model.type) || sameCategory(piece.category, Option.getOrNull(model.category))) &&
      (model.filters.colours.length === 0 || piece.colours.some((colour) => model.filters.colours.includes(colour))) &&
      Option.match(model.filters.season, {
        onNone: () => true,
        onSome: (season) => piece.seasons.length === 0 || piece.seasons.includes(season),
      }) &&
      (!model.filters.rainproof || piece.rainproof) &&
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

/** Renaming or deleting the category the page shows (T-12): the name being typed, or the delete being confirmed, each
 * with whether it is on its way and whether the last try failed. */
export const CategoryEdit = defineTaggedUnion({
  Idle: {},
  Renaming: { name: Schema.String, sending: Schema.Boolean, failed: Schema.Boolean },
  Deleting: { sending: Schema.Boolean, failed: Schema.Boolean },
})
export type CategoryEdit = typeof CategoryEdit.Type

export const Model = Schema.Struct({
  /** The group being browsed, then one of its types, whose pieces show; none shows the groups. */
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  category: Schema.Option(Schema.String),
  categoryEdit: CategoryEdit,
  filters: Filters,
  filterSheet: Dialog.Model,
})
export type Model = typeof Model.Type

export const init = (query: BrowseQuery = {}): Model => ({
  ...browsing(query),
  categoryEdit: CategoryEdit.Idle(),
  filterSheet: Dialog.init({ id: 'wardrobe-filters', isAnimated: true }),
})

const browsing = (query: BrowseQuery) => ({
  group: Option.fromNullishOr(query.group),
  type: Option.filter(
    Option.fromNullishOr(query.type),
    (type) => query.group === undefined || groupOf(type) === query.group,
  ),
  category: query.type === undefined ? Option.none() : Option.fromNullishOr(query.category),
  filters: {
    colours: Option.getOrElse(browseColours(query.colours?.split(',') ?? []), () => []),
    season: Option.fromNullishOr(query.season),
    rainproof: query.rainproof === 'yes',
    occasion: Option.fromNullishOr(query.occasion),
    brand: Option.fromNullishOr(query.brand),
  },
})

export const restore = (model: Model, query: BrowseQuery): Model => {
  const restored = browsing(query)
  return modifyFields(model, {
    group: () => restored.group,
    type: () => restored.type,
    category: () => restored.category,
    categoryEdit: () => CategoryEdit.Idle(),
    filters: () => restored.filters,
  })
}

export const queryOf = (model: Model): BrowseQuery => ({
  ...Option.match(model.group, { onNone: () => ({}), onSome: (group) => ({ group }) }),
  ...Option.match(model.type, { onNone: () => ({}), onSome: (type) => ({ type }) }),
  ...Option.match(model.category, { onNone: () => ({}), onSome: (category) => ({ category }) }),
  ...(model.filters.colours.length === 0 ? {} : { colours: model.filters.colours.join(',') }),
  ...Option.match(model.filters.season, { onNone: () => ({}), onSome: (season) => ({ season }) }),
  ...(model.filters.rainproof ? { rainproof: 'yes' as const } : {}),
  ...Option.match(model.filters.occasion, { onNone: () => ({}), onSome: (occasion) => ({ occasion }) }),
  ...Option.match(model.filters.brand, { onNone: () => ({}), onSome: (brand) => ({ brand }) }),
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedFilters: {},
  GotFilterSheetMessage: { message: Dialog.Message },
  ToggledFilterColour: { colour: Colour },
  ChoseFilterSeason: { season: Season },
  ToggledFilterRainproof: {},
  ChoseFilterOccasion: { occasion: Occasion },
  ChoseFilterBrand: { brand: Schema.String },
  ClickedClearFilters: {},
  ClickedShowPieces: {},
  ClickedRetry: {},
  ClickedRenameCategory: {},
  UpdatedCategoryName: { value: Schema.String },
  SubmittedCategoryName: {},
  ClickedDeleteCategory: {},
  ClickedConfirmDeleteCategory: {},
  ClickedCancelCategoryEdit: {},
  SucceededRenameCategory: { name: Schema.String },
  SucceededDeleteCategory: {},
  FailedCategoryEdit: {},
})
export type Message = typeof Message.Type

/** The pieces are the app's: the page asks for them again after a failure, and once a category it shows was renamed
 * or deleted (`reread`), with the address it now shows. */
export const OutMessage = defineMessageUnion({
  RequestedPieces: {},
  ChangedBrowse: { query: BrowseQuery, reread: Schema.optionalKey(Schema.Boolean) },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Rename one of the person's categories under a type: its pieces move to the new name. */
export const RenameCategory = Command.define('RenameCategory', {
  args: { type: PieceType, name: Schema.String, to: Schema.String },
  messages: [Message.SucceededRenameCategory, Message.FailedCategoryEdit],
  execute: ({ type, name, to }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.wardrobe.renameCategory({ payload: { operationId: yield* drawOperationId(), type, name, to } })
      return Message.SucceededRenameCategory({ name: to })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCategoryEdit())),
})

/** Delete one of the person's categories under a type: its pieces stay, under the type alone. */
export const DeleteCategory = Command.define('DeleteCategory', {
  args: { type: PieceType, name: Schema.String },
  messages: [Message.SucceededDeleteCategory, Message.FailedCategoryEdit],
  execute: ({ type, name }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.wardrobe.deleteCategory({ payload: { operationId: yield* drawOperationId(), type, name } })
      return Message.SucceededDeleteCategory()
    }).pipe(Effect.orElseSucceed(() => Message.FailedCategoryEdit())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

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
    ToggledFilterRainproof: () =>
      filtered(model, (filters) => modifyFields(filters, { rainproof: (rainproof) => !rainproof })),
    ChoseFilterOccasion: ({ occasion }) =>
      filtered(model, (filters) => modifyFields(filters, { occasion: (chosen) => chosenAgain(occasion, chosen) })),
    ChoseFilterBrand: ({ brand }) =>
      filtered(model, (filters) => modifyFields(filters, { brand: (chosen) => chosenAgain(brand, chosen) })),
    ClickedClearFilters: () => filtered(model, () => noFilters),
    ClickedShowPieces: () => closeFilterSheet(model),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    ...categoryUpdates(model),
  })

const editing = (model: Model, categoryEdit: CategoryEdit): UpdateReturn => ({
  model: modifyFields(model, { categoryEdit: () => categoryEdit }),
})

/** The category the page shows, with its type: what a rename or a delete acts on. */
const shownCategory = (model: Model) => Option.all({ type: model.type, name: model.category })

/** Renaming or deleting the category the page shows; once done, the page shows where its pieces are now and the app
 * reads them again. */
const categoryUpdates = (model: Model) => ({
  ClickedRenameCategory: () =>
    editing(
      model,
      CategoryEdit.Renaming({ name: Option.getOrElse(model.category, () => ''), sending: false, failed: false }),
    ),
  UpdatedCategoryName: ({ value }: { readonly value: string }) =>
    CategoryEdit.guards.Renaming(model.categoryEdit)
      ? editing(model, CategoryEdit.Renaming({ ...model.categoryEdit, name: value }))
      : { model },
  SubmittedCategoryName: (): UpdateReturn => {
    const edit = model.categoryEdit
    const shown = shownCategory(model)
    if (!CategoryEdit.guards.Renaming(edit) || edit.sending || Option.isNone(shown)) return { model }
    const to = edit.name.trim()
    if (to === '' || to === shown.value.name) return editing(model, CategoryEdit.Idle())
    return {
      ...editing(model, CategoryEdit.Renaming({ name: edit.name, sending: true, failed: false })),
      commands: [RenameCategory({ ...shown.value, to })],
    }
  },
  ClickedDeleteCategory: () => editing(model, CategoryEdit.Deleting({ sending: false, failed: false })),
  ClickedConfirmDeleteCategory: (): UpdateReturn => {
    const shown = shownCategory(model)
    if (!CategoryEdit.guards.Deleting(model.categoryEdit) || model.categoryEdit.sending || Option.isNone(shown))
      return { model }
    return {
      ...editing(model, CategoryEdit.Deleting({ sending: true, failed: false })),
      commands: [DeleteCategory(shown.value)],
    }
  },
  ClickedCancelCategoryEdit: () => editing(model, CategoryEdit.Idle()),
  SucceededRenameCategory: ({ name }: { readonly name: string }) => {
    const renamed = modifyFields(model, { category: () => Option.some(name), categoryEdit: () => CategoryEdit.Idle() })
    return { model: renamed, outMessage: OutMessage.ChangedBrowse({ query: queryOf(renamed), reread: true }) }
  },
  SucceededDeleteCategory: () => {
    const deleted = modifyFields(model, { category: () => Option.none(), categoryEdit: () => CategoryEdit.Idle() })
    return { model: deleted, outMessage: OutMessage.ChangedBrowse({ query: queryOf(deleted), reread: true }) }
  },
  FailedCategoryEdit: () =>
    editing(
      model,
      CategoryEdit.match(model.categoryEdit, {
        Idle: () => CategoryEdit.Idle(),
        Renaming: (edit) => CategoryEdit.Renaming({ ...edit, sending: false, failed: true }),
        Deleting: () => CategoryEdit.Deleting({ sending: false, failed: true }),
      }),
    ),
})
