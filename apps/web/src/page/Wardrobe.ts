import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Dialog } from '@foldkit/ui'
import { Colour, groupOf, Occasion, Piece, PieceType, Season } from '@styld/protocol'
import { Array, Effect, Option, Order, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import { replaceUrl } from 'foldkit/navigation'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'
import * as WardrobeSelect from './WardrobeSelect.ts'
import { drawOperationId } from '../OperationIds.ts'
import { StyldClient } from '../StyldClient.ts'
import { browseRouter } from '../route.ts'
import { Browse, type Filters, noFilters, sameLevel } from '../WardrobeBrowse.ts'

// The wardrobe tab: the person's pieces (the app's, read once for every page that shows them), browsed as a shop is
// (owner, 2026-11-03, T-07): the groups as cards, then the chosen group's types as cards, then the chosen type's
// pieces, narrowed by the filter sheet. Each step down is a link, so the phone's Back goes a step up. What is browsed
// lives only in the address (`WardrobeBrowse.ts`, Foldkit's query-sync): the view and update get it from the route,
// a filter replaces the address, and this Model keeps only what is the page's own (the sheet, a category being
// edited, Select mode).

// MODEL

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
export const shownPieces = (pieces: ReadonlyArray<Piece>, browse: Browse): ReadonlyArray<Piece> =>
  Array.filter(
    pieces,
    (piece) =>
      Option.match(browse.group, { onNone: () => true, onSome: (group) => groupOf(piece.type) === group }) &&
      Option.match(browse.type, { onNone: () => true, onSome: (type) => piece.type === type }) &&
      // Under a type, its pieces of no category of the person's own, or those of the one chosen, whatever its case
      // (a rename that joins a category keeps that one's spelling; T-12).
      (Option.isNone(browse.type) || sameCategory(piece.category, Option.getOrNull(browse.category))) &&
      (browse.filters.colours.length === 0 ||
        piece.colours.some((colour) => browse.filters.colours.includes(colour))) &&
      Option.match(browse.filters.season, {
        onNone: () => true,
        onSome: (season) => piece.seasons.length === 0 || piece.seasons.includes(season),
      }) &&
      (!browse.filters.rainproof || piece.rainproof) &&
      Option.match(browse.filters.occasion, {
        onNone: () => true,
        onSome: (occasion) => piece.occasions.includes(occasion),
      }) &&
      Option.match(browse.filters.brand, { onNone: () => true, onSome: (brand) => piece.brand === brand }),
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
  categoryEdit: CategoryEdit,
  filterSheet: Dialog.Model,
  /** Select mode on a type's pieces, to delete several at once (`WardrobeSelect.ts`). */
  selection: WardrobeSelect.Model,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  categoryEdit: CategoryEdit.Idle(),
  filterSheet: Dialog.init({ id: 'wardrobe-filters', isAnimated: true }),
  selection: WardrobeSelect.init(),
})

/** What the page is given with each Message: the browse the address shows, when the wardrobe is on screen (a rename
 * or a Select mode answer can land while another tab shows). */
export type Context = Readonly<{ maybeBrowse: Option.Option<Browse> }>

/** The address moved to another browse: a category being edited and Select mode belong to the one left, so they end;
 * the filter sheet stays open while its filters change the address. */
export const reflectBrowse =
  (maybePrevious: Option.Option<Browse>, next: Browse) =>
  (model: Model): Model =>
    Option.exists(maybePrevious, (previous) => sameLevel(previous, next))
      ? model
      : modifyFields(model, { categoryEdit: () => CategoryEdit.Idle(), selection: () => WardrobeSelect.init() })

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
  /** The category renamed, under its type: the address follows only while the page still shows it. */
  SucceededRenameCategory: { type: PieceType, name: Schema.String, to: Schema.String },
  SucceededDeleteCategory: { type: PieceType, name: Schema.String },
  FailedCategoryEdit: {},
  GotSelectMessage: { message: WardrobeSelect.Message },
  CompletedReplaceBrowse: {},
})
export type Message = typeof Message.Type

/** The pieces are the app's: the page asks for them again after a failure and once a category was renamed or
 * deleted, and at once once some were deleted here. */
export const OutMessage = defineMessageUnion({
  RequestedPieces: {},
  DeletedPieces: {},
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
      return Message.SucceededRenameCategory({ type, name, to })
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
      return Message.SucceededDeleteCategory({ type, name })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCategoryEdit())),
})

/** Show another browse in place of this one: the address changes without a Back step, and the route follows. */
export const ReplaceBrowse = Command.define('ReplaceBrowse', {
  args: { browse: Browse },
  messages: [Message.CompletedReplaceBrowse],
  execute: ({ browse }) => replaceUrl(browseRouter({ browse })).pipe(Effect.as(Message.CompletedReplaceBrowse())),
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

const foldSelection = Update.foldChild({
  update: WardrobeSelect.update,
  read: (model: Model) => Option.some(model.selection),
  write: (model: Model, selection: WardrobeSelect.Model) => modifyFields(model, { selection: () => selection }),
  toParentMessage: (message: WardrobeSelect.Message) => Message.GotSelectMessage({ message }),
  foldOutMessage: WardrobeSelect.OutMessage.match<
    Update.StepWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>
  >({
    DeletedPieces: () => (stepModel) => ({ model: stepModel, outMessage: OutMessage.DeletedPieces() }),
  }),
})

/** Choosing the chosen one again clears it. */
const chosenAgain = <A>(value: A, chosen: Option.Option<A>): Option.Option<A> =>
  Option.contains(chosen, value) ? Option.none() : Option.some(value)

/** The browse shown with its filters changed, in place of the address; nothing while no browse is shown. */
const filtered = (model: Model, context: Context, change: (filters: Filters) => Filters): UpdateReturn =>
  Option.match(context.maybeBrowse, {
    onNone: () => ({ model }),
    onSome: (browse) => ({
      model,
      commands: [ReplaceBrowse({ browse: modifyFields(browse, { filters: change }) })],
    }),
  })

export const update = (model: Model, message: Message, context: Context): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedFilters: () => openFilterSheet(model),
    GotFilterSheetMessage: ({ message: sheetMessage }) => foldFilterSheet(model, sheetMessage),
    ToggledFilterColour: ({ colour }) =>
      filtered(model, context, (filters) =>
        modifyFields(filters, {
          colours: (colours) =>
            colours.includes(colour) ? colours.filter((each) => each !== colour) : [...colours, colour],
        }),
      ),
    ChoseFilterSeason: ({ season }) =>
      filtered(model, context, (filters) => modifyFields(filters, { season: (chosen) => chosenAgain(season, chosen) })),
    ToggledFilterRainproof: () =>
      filtered(model, context, (filters) => modifyFields(filters, { rainproof: (rainproof) => !rainproof })),
    ChoseFilterOccasion: ({ occasion }) =>
      filtered(model, context, (filters) =>
        modifyFields(filters, { occasion: (chosen) => chosenAgain(occasion, chosen) }),
      ),
    ChoseFilterBrand: ({ brand }) =>
      filtered(model, context, (filters) => modifyFields(filters, { brand: (chosen) => chosenAgain(brand, chosen) })),
    ClickedClearFilters: () => filtered(model, context, () => noFilters),
    ClickedShowPieces: () => closeFilterSheet(model),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    GotSelectMessage: ({ message: selectMessage }) => foldSelection(model, selectMessage),
    CompletedReplaceBrowse: () => ({ model }),
    ...categoryUpdates(model, context),
  })

const editing = (model: Model, categoryEdit: CategoryEdit): UpdateReturn => ({
  model: modifyFields(model, { categoryEdit: () => categoryEdit }),
})

/** The category the page shows, with its type: what a rename or a delete acts on. */
const shownCategory = (context: Context) =>
  Option.flatMap(context.maybeBrowse, (browse) => Option.all({ type: browse.type, name: browse.category }))

/** A rename or delete done: the pieces are read again, and the address follows only while the page still shows the
 * category acted on (the person may have browsed on while it was sent). */
const categoryChanged = (
  model: Model,
  context: Context,
  done: { readonly type: PieceType; readonly name: string },
  to: Option.Option<string>,
): UpdateReturn => {
  const stillShown = Option.flatMap(context.maybeBrowse, (browse) =>
    Option.contains(browse.type, done.type) && Option.contains(browse.category, done.name)
      ? Option.some(browse)
      : Option.none(),
  )
  return {
    model: modifyFields(model, { categoryEdit: () => CategoryEdit.Idle() }),
    commands: Option.match(stillShown, {
      onNone: () => [],
      onSome: (browse) => [ReplaceBrowse({ browse: modifyFields(browse, { category: () => to }) })],
    }),
    outMessage: OutMessage.RequestedPieces(),
  }
}

/** Renaming or deleting the category the page shows; once done, the page shows where its pieces are now and the app
 * reads them again. */
const categoryUpdates = (model: Model, context: Context) => ({
  ClickedRenameCategory: () =>
    editing(
      model,
      CategoryEdit.Renaming({
        name: Option.getOrElse(
          Option.map(shownCategory(context), ({ name }) => name),
          () => '',
        ),
        sending: false,
        failed: false,
      }),
    ),
  UpdatedCategoryName: ({ value }: { readonly value: string }) =>
    CategoryEdit.guards.Renaming(model.categoryEdit)
      ? editing(model, CategoryEdit.Renaming({ ...model.categoryEdit, name: value }))
      : { model },
  SubmittedCategoryName: (): UpdateReturn => {
    const edit = model.categoryEdit
    const shown = shownCategory(context)
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
    const shown = shownCategory(context)
    if (!CategoryEdit.guards.Deleting(model.categoryEdit) || model.categoryEdit.sending || Option.isNone(shown))
      return { model }
    return {
      ...editing(model, CategoryEdit.Deleting({ sending: true, failed: false })),
      commands: [DeleteCategory(shown.value)],
    }
  },
  ClickedCancelCategoryEdit: () => editing(model, CategoryEdit.Idle()),
  SucceededRenameCategory: (done: { readonly type: PieceType; readonly name: string; readonly to: string }) =>
    categoryChanged(model, context, done, Option.some(done.to)),
  SucceededDeleteCategory: (done: { readonly type: PieceType; readonly name: string }) =>
    categoryChanged(model, context, done, Option.none()),
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
