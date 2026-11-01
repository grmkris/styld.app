import * as Crypto from 'effect/Crypto'
import { newOperationId } from '../OperationIds.ts'
import { Dialog } from '@foldkit/ui'
import { Colour, GarmentGroup, groupOf, Occasion, Piece, PieceType, Season } from '@styld/protocol'
import { Array, Duration, Effect, Option, Order, Result, Schema, Stream } from 'effect'
import { AsyncData, Command, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** The person's pieces as last read. Pages that show them keep them on screen while they are asked for again. */
export const PiecesData = AsyncData.Schema(Schema.Array(Piece), Schema.Literal('Unavailable'))
export type PiecesData = typeof PiecesData.schema.Type

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

export const Model = Schema.Struct({
  pieces: PiecesData.schema,
  /** The group the grid shows, then one of its types; none shows every piece. */
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  filters: Filters,
  filterSheet: Dialog.Model,
  /** Kept cut-outs with no clean picture yet, and how asking for theirs went. */
  undrawn: Schema.Number,
  backfill: Schema.Literals(['idle', 'sending', 'sent', 'failed']),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  pieces: AsyncData.Idle(),
  group: Option.none(),
  type: Option.none(),
  filters: noFilters,
  filterSheet: Dialog.init({ id: 'wardrobe-filters', isAnimated: true }),
  undrawn: 0,
  backfill: 'idle',
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListPieces: { pieces: Schema.Array(Piece) },
  FailedListPieces: {},
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
  TickedRefresh: {},
  CompletedCountUndrawn: { pieces: Schema.Number },
  ClickedDrawPictures: {},
  SucceededDrawPictures: {},
  FailedDrawPictures: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for its tests. */
export const ListPieces = Command.define('ListPieces', {
  messages: [Message.SucceededListPieces, Message.FailedListPieces],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { pieces } = yield* api.wardrobe.listPieces()
    return Message.SucceededListPieces({ pieces })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListPieces())),
})

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

/** The Commands that open the page for a page that keeps its own copy of the pieces. */
export const load = () => [ListPieces()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | Crypto.Crypto>

const piecesCache = (revalidate: (pieces: PiecesData) => Option.Option<PiecesData>) =>
  Update.refresh<Model, Message, ReadonlyArray<Piece>, 'Unavailable', StyldClient>({
    read: (model: Model) => Option.some(model.pieces),
    revalidate,
    write: (model: Model, pieces: PiecesData) => modifyFields(model, { pieces: () => pieces }),
    load: ListPieces(),
  })

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

/** Opening a page that shows the pieces: those already here stay on screen while they are asked for again, a
 * first visit asks, and a request on its way is not repeated. */
export const revisit = piecesCache(AsyncData.revalidateOrLoad)
/** Asking again for pieces already here, such as while one is processing. */
const refresh = piecesCache(AsyncData.revalidate)

/** Opening the wardrobe page itself: its pieces, and how many have no clean picture yet. */
export const enter = (model: Model): UpdateReturn => {
  const opened = revisit(model)
  return { ...opened, commands: [...(opened.commands ?? []), CountUndrawn()] }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListPieces: ({ pieces }) => ({
      model: modifyFields(model, { pieces: () => PiecesData.Success({ data: pieces }) }),
    }),
    // A failed refresh keeps the pieces already shown.
    FailedListPieces: () => ({
      model: modifyFields(model, { pieces: (pieces) => AsyncData.settle(pieces, Result.fail('Unavailable' as const)) }),
    }),
    // Another group starts from all of its types.
    ClickedGroup: ({ group }) => ({ model: modifyFields(model, { group: () => group, type: () => Option.none() }) }),
    ClickedType: ({ type }) => ({ model: modifyFields(model, { type: () => type }) }),
    ClickedFilters: () => openFilterSheet(model),
    GotFilterSheetMessage: ({ message: sheetMessage }) => foldFilterSheet(model, sheetMessage),
    ToggledFilterColour: ({ colour }) =>
      filtered(model, (filters) => ({
        ...filters,
        colours: filters.colours.includes(colour)
          ? filters.colours.filter((each) => each !== colour)
          : [...filters.colours, colour],
      })),
    ChoseFilterSeason: ({ season }) =>
      filtered(model, (filters) => ({ ...filters, season: chosenAgain(season, filters.season) })),
    ChoseFilterOccasion: ({ occasion }) =>
      filtered(model, (filters) => ({ ...filters, occasion: chosenAgain(occasion, filters.occasion) })),
    ChoseFilterBrand: ({ brand }) =>
      filtered(model, (filters) => ({ ...filters, brand: chosenAgain(brand, filters.brand) })),
    ClickedClearFilters: () => filtered(model, () => noFilters),
    ClickedShowPieces: () => closeFilterSheet(model),
    ClickedRetry: () => revisit(model),
    TickedRefresh: () => refresh(model),
    CompletedCountUndrawn: ({ pieces }) => ({ model: modifyFields(model, { undrawn: () => pieces }) }),
    ClickedDrawPictures: () =>
      model.backfill === 'sending'
        ? { model }
        : { model: modifyFields(model, { backfill: () => 'sending' as const }), commands: [DrawPictures()] },
    // The pieces are read again, so each shows its drawing on its way.
    SucceededDrawPictures: () => refresh(modifyFields(model, { undrawn: () => 0, backfill: () => 'sent' as const })),
    FailedDrawPictures: () => ({ model: modifyFields(model, { backfill: () => 'failed' as const }) }),
  })

// SUBSCRIPTION

/** A new photo is ready within seconds, so the pieces are asked for again this often while one is processing. */
const refreshPause = Duration.seconds(2)

/** Whether a piece is still processing or its clean picture is being drawn. */
const isProcessing = (pieces: PiecesData) =>
  AsyncData.getData(pieces).pipe(
    Option.exists((list) => list.some((piece) => piece.status === 'processing' || piece.picture?.state === 'drawing')),
  )

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  refreshWhileProcessing: entry(
    { isActive: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isActive: isProcessing(model.pieces) }),
      dependenciesToStream: ({ isActive }) =>
        Stream.when(
          Stream.tick(refreshPause).pipe(Stream.drop(1), Stream.map(Message.TickedRefresh)),
          Effect.sync(() => isActive),
        ),
    },
  ),
}))
