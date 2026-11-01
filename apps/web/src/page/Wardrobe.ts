import * as Crypto from 'effect/Crypto'
import { newOperationId } from '../OperationIds.ts'
import { Dialog } from '@foldkit/ui'
import { Colour, GarmentGroup, groupOf, Occasion, Piece, PieceType, Season } from '@styld/protocol'
import { Array, Effect, Option, Order, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// The wardrobe tab: the person's pieces (the app's, read once for every page that shows them) browsed by group and
// type and narrowed by the filter sheet.

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

/** Asking for clean pictures of the kept cut-outs that have none. */
const Backfill = Schema.Literals(['idle', 'sending', 'sent', 'failed'])

export const Model = Schema.Struct({
  /** The group the grid shows, then one of its types; none shows every piece. */
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  filters: Filters,
  filterSheet: Dialog.Model,
  /** Kept cut-outs with no clean picture yet, and how asking for theirs went. */
  undrawn: Schema.Number,
  backfill: Backfill,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  group: Option.none(),
  type: Option.none(),
  filters: noFilters,
  filterSheet: Dialog.init({ id: 'wardrobe-filters', isAnimated: true }),
  undrawn: 0,
  backfill: 'idle',
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedGroup: { group: Schema.Option(GarmentGroup) },
  ClickedType: { type: Schema.Option(PieceType) },
  ClickedFilters: {},
  GotFilterSheetMessage: { message: Dialog.Message },
  ToggledFilterColour: { colour: Colour },
  ChoseFilterSeason: { season: Season },
  ChoseFilterOccasion: { occasion: Occasion },
  ChoseFilterBrand: { brand: Schema.String },
  ClickedClearFilters: {},
  ClickedShowPieces: {},
  ClickedRetry: {},
  CompletedCountUndrawn: { pieces: Schema.Number },
  ClickedDrawPictures: {},
  SucceededDrawPictures: {},
  FailedDrawPictures: {},
})
export type Message = typeof Message.Type

/** The pieces are the app's: the page asks for them again after a failure, and once their pictures are being drawn. */
export const OutMessage = defineMessageUnion({ RequestedPieces: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** @internal Exported for its tests. */
export const CountUndrawn = Command.define('CountUndrawn', {
  messages: [Message.CompletedCountUndrawn],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { pieces } = yield* api.capture.undrawnPictures()
    return Message.CompletedCountUndrawn({ pieces })
  }).pipe(Effect.orElseSucceed(() => Message.CompletedCountUndrawn({ pieces: 0 }))),
})

/** @internal Exported for its tests. */
export const DrawPictures = Command.define('DrawPictures', {
  messages: [Message.SucceededDrawPictures, Message.FailedDrawPictures],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    yield* api.capture.drawPictures({ payload: { operationId: yield* newOperationId } })
    return Message.SucceededDrawPictures()
  }).pipe(Effect.orElseSucceed(() => Message.FailedDrawPictures())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | Crypto.Crypto>

const sheetFold = {
  read: (model: Model) => Option.some(model.filterSheet),
  write: (model: Model, filterSheet: Dialog.Model) => modifyFields(model, { filterSheet: () => filterSheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotFilterSheetMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
}
const foldFilterSheet = Update.foldChild({ update: Dialog.update, ...sheetFold })
const openFilterSheet = Update.foldChildStep({ update: Dialog.open, ...sheetFold })
const closeFilterSheet = Update.foldChildStep({ update: Dialog.close, ...sheetFold })

/** Choosing the chosen one again clears it. */
const chosenAgain = <A>(value: A, chosen: Option.Option<A>): Option.Option<A> =>
  Option.contains(chosen, value) ? Option.none() : Option.some(value)

const filtered = (model: Model, change: (filters: Filters) => Filters): UpdateReturn => ({
  model: modifyFields(model, { filters: change }),
})

/** Opening the wardrobe tab: how many kept cut-outs have no clean picture yet. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> => ({
  model,
  commands: [CountUndrawn()],
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // Another group starts from all of its types.
    ClickedGroup: ({ group }) => ({ model: modifyFields(model, { group: () => group, type: () => Option.none() }) }),
    ClickedType: ({ type }) => ({ model: modifyFields(model, { type: () => type }) }),
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
    CompletedCountUndrawn: ({ pieces }) => ({ model: modifyFields(model, { undrawn: () => pieces }) }),
    ClickedDrawPictures: () =>
      model.backfill === 'sending'
        ? { model }
        : { model: modifyFields(model, { backfill: () => 'sending' as const }), commands: [DrawPictures()] },
    // The pieces are read again, so each shows its drawing on its way.
    SucceededDrawPictures: () => ({
      model: modifyFields(model, { undrawn: () => 0, backfill: () => 'sent' as const }),
      outMessage: OutMessage.RequestedPieces(),
    }),
    FailedDrawPictures: () => ({ model: modifyFields(model, { backfill: () => 'failed' as const }) }),
  })
