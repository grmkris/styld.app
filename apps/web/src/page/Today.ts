import { cdn } from '../Cdn.ts'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { drawOperationId } from '../OperationIds.ts'
import {
  Day,
  Feed,
  mostLocked,
  mostSeen,
  OutfitBrief,
  outfitKeyOf,
  OutfitKey,
  OutfitProposal,
  OutfitProposals,
  OutfitSession,
  Photo,
  type Piece,
  PieceId,
  ProposalRef,
  Slot,
} from '@styld/protocol'
import { Array, Clock, Effect, Option, Order, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** Whether today's outfit is recorded: not yet, on its way, worn (with the pieces worn), not saved, or not known
 * because reading it failed (the note says so and offers to read it again). */
export const Worn = defineTaggedUnion({
  NotYet: {},
  Saving: {},
  Worn: { pieceIds: Schema.Array(PieceId) },
  Failed: {},
  Unread: {},
})
export type Worn = typeof Worn.Type

/** Swapping one piece of the outfit on the table for another that goes with the rest: none asked for, one on its way
 * from the outfit it was asked from, or one that found nothing else or did not come through. */
export const Swap = defineTaggedUnion({
  Idle: {},
  Swapping: { pieceId: PieceId, from: OutfitKey },
  NoOther: { pieceId: PieceId },
  Failed: { pieceId: PieceId },
})
export type Swap = typeof Swap.Type

/** Whether the table was just spun: only then do its pieces drop in. Opening Home shows the table as it lies. */
export const TableMotion = defineTaggedUnion({ Still: {}, Spun: {} })

/** The newest favourite photo of My Gallery, for "Wear it again". */
export const FavouriteData = AsyncData.Schema(Schema.Option(Photo), Schema.Literal('Unavailable'))
export type FavouriteData = typeof FavouriteData.schema.Type
/** What people the person follows made public lately. */
export const FeedData = AsyncData.Schema(Feed, Schema.Literal('Unavailable'))
export type FeedData = typeof FeedData.schema.Type
/** The review tray as Home shows it: how many found pieces wait, and the first three's pictures. */
export const Tray = Schema.Struct({ waiting: Schema.Int, pictures: Schema.Array(Schema.String) })
export type Tray = typeof Tray.Type
export const TrayData = AsyncData.Schema(Tray, Schema.Literal('Unavailable'))
export type TrayData = typeof TrayData.schema.Type

/** Today's outfits from the engine (Fast): every proposal of the run so far, best first within each batch, which one
 * is on the table, what the wardrobe lacks, and whether the rules have more and more are on their way. */
export const Outfits = Schema.Struct({
  session: OutfitSession,
  proposals: Schema.Array(OutfitProposal),
  at: Schema.Int,
  missing: Schema.Array(Slot),
  exhausted: Schema.Boolean,
  refilling: Schema.Boolean,
})
export type Outfits = typeof Outfits.Type
export const OutfitsData = AsyncData.Schema(Outfits, Schema.Literal('Unavailable'))
export type OutfitsData = typeof OutfitsData.schema.Type

/** Home for a signed-in person: today's outfit on the table, then where they left off. The pieces and boards are
 * the app's, which it keeps once for every page. */
export const Model = Schema.Struct({
  /** Today in the person's own time zone, read in the browser. */
  maybeDay: Schema.Option(Day),
  outfits: OutfitsData.schema,
  /** Whether the table shows what was worn today, until Spin brings a proposal in. */
  showsWorn: Schema.Boolean,
  motion: TableMotion,
  /** The outfit on the table after the person swapped one of its pieces, in place of the proposal Spin reached. */
  maybeSwapped: Schema.Option(Schema.Array(PieceId)),
  swap: Swap,
  worn: Worn,
  favourite: FavouriteData.schema,
  tray: TrayData.schema,
  feed: FeedData.schema,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  maybeDay: Option.none(),
  outfits: AsyncData.Idle(),
  showsWorn: true,
  motion: TableMotion.Still(),
  maybeSwapped: Option.none(),
  swap: Swap.Idle(),
  worn: Worn.NotYet(),
  favourite: AsyncData.Idle(),
  tray: AsyncData.Idle(),
  feed: AsyncData.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  CompletedDetermineDay: { day: Day },
  SucceededReadWorn: { pieceIds: Schema.Array(PieceId) },
  FailedReadWorn: {},
  SucceededReadFavourite: { maybePhoto: Schema.Option(Photo) },
  FailedReadFavourite: {},
  SucceededReadTray: { tray: Tray },
  FailedReadTray: {},
  SucceededReadFeed: { feed: Feed },
  FailedReadFeed: {},
  SucceededMakeOutfits: { batch: OutfitProposals },
  FailedMakeOutfits: {},
  ClickedSpin: {},
  /** The piece to swap, and the pieces on the table when it was pressed. */
  ClickedSwapPiece: { pieceId: PieceId, pieceIds: Schema.Array(PieceId) },
  SucceededSwapPiece: { pieceId: PieceId, from: OutfitKey, proposals: Schema.Array(OutfitProposal) },
  FailedSwapPiece: { pieceId: PieceId, from: OutfitKey },
  /** The pieces on the table when Wear this was pressed. */
  ClickedWear: { pieceIds: Schema.Array(PieceId) },
  SucceededWear: { pieceIds: Schema.Array(PieceId) },
  FailedWear: {},
  ClickedRetry: {},
  ClickedRetryOutfits: {},
  ClickedRetryWorn: {},
})
export type Message = typeof Message.Type

/** The pieces didn't load: the app asks for them again. */
export const OutMessage = defineMessageUnion({ RequestedPieces: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Today in the browser's own time zone (the server renders in UTC). `en-CA` writes dates as `2026-10-30`.
 */
export const DetermineDay = Command.define('DetermineDay', {
  messages: [Message.CompletedDetermineDay],
  execute: Clock.currentTimeMillis.pipe(
    Effect.map((now) =>
      new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
    ),
    Effect.flatMap((text) => Schema.decodeUnknownEffect(Day)(text)),
    Effect.map((day) => Message.CompletedDetermineDay({ day })),
    Effect.orDie,
  ),
})

export const ReadWorn = Command.define('ReadWorn', {
  args: { day: Day },
  messages: [Message.SucceededReadWorn, Message.FailedReadWorn],
  execute: ({ day }) =>
    Effect.gen(function* () {
      const { days } = yield* (yield* (yield* StyldClient).api).worn.listWorn({ query: { from: day, to: day } })
      return Message.SucceededReadWorn({ pieceIds: days[0]?.pieceIds ?? [] })
    }).pipe(Effect.orElseSucceed(() => Message.FailedReadWorn())),
})

export const ReadFeed = Command.define('ReadFeed', {
  messages: [Message.SucceededReadFeed, Message.FailedReadFeed],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededReadFeed({ feed: yield* api.social.feed({ query: {} }) })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadFeed())),
})

export const ReadFavourite = Command.define('ReadFavourite', {
  messages: [Message.SucceededReadFavourite, Message.FailedReadFavourite],
  execute: Effect.gen(function* () {
    const { photos } = yield* (yield* (yield* StyldClient).api).photo.listPhotos()
    const maybePhoto = Array.findFirst(photos, (photo) => photo.favourite && photo.status === 'ready')
    return Message.SucceededReadFavourite({ maybePhoto })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadFavourite())),
})

export const ReadTray = Command.define('ReadTray', {
  messages: [Message.SucceededReadTray, Message.FailedReadTray],
  execute: Effect.gen(function* () {
    const { captures } = yield* (yield* (yield* StyldClient).api).capture.tray()
    const detections = captures.flatMap((capture) => capture.detections)
    // A found piece's cut-out when it has one, else its photo, as the tray first shows it.
    const pictures = detections.slice(0, 3).map((detection) => cdn.detection(detection, detection.hasCutout))
    return Message.SucceededReadTray({ tray: { waiting: detections.length, pictures } })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadTray())),
})

/** How many outfits one request asks for, and how few left on the table ask for more. */
const batchSize = 6
const refillAt = 2

/** Today's outfits, made by the engine's Fast way, as a new run or more of one.
 */
export const MakeOutfits = Command.define('MakeOutfits', {
  args: { day: Day, brief: OutfitBrief, session: Schema.Option(OutfitSession), seen: Schema.Array(OutfitKey) },
  messages: [Message.SucceededMakeOutfits, Message.FailedMakeOutfits],
  execute: ({ day, brief, session, seen }) =>
    Effect.gen(function* () {
      const batch = yield* (yield* (yield* StyldClient).api).outfit.makeOutfit({
        payload: {
          operationId: yield* drawOperationId(),
          mode: 'fast',
          day,
          brief,
          ...Option.match(session, { onNone: () => ({}), onSome: (value) => ({ session: value }) }),
          lockedPieceIds: [],
          seen,
          count: batchSize,
        },
      })
      return Message.SucceededMakeOutfits({ batch })
    }).pipe(Effect.orElseSucceed(() => Message.FailedMakeOutfits())),
})

/** How many outfits a swap asks for: the first of them without the piece swapped out is shown. */
const swapCount = 3

/** Outfits that keep every other piece on the table, made by the engine's Fast way within the run, for swapping one.
 */
export const SwapPiece = Command.define('SwapPiece', {
  args: {
    day: Day,
    brief: OutfitBrief,
    session: OutfitSession,
    lockedPieceIds: Schema.Array(PieceId),
    seen: Schema.Array(OutfitKey),
    pieceId: PieceId,
    from: OutfitKey,
  },
  messages: [Message.SucceededSwapPiece, Message.FailedSwapPiece],
  execute: ({ day, brief, session, lockedPieceIds, seen, pieceId, from }) =>
    Effect.gen(function* () {
      const batch = yield* (yield* (yield* StyldClient).api).outfit.makeOutfit({
        payload: {
          operationId: yield* drawOperationId(),
          mode: 'fast',
          day,
          brief,
          session,
          lockedPieceIds,
          seen,
          count: swapCount,
        },
      })
      return Message.SucceededSwapPiece({ pieceId, from, proposals: batch.proposals })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSwapPiece({ pieceId, from }))),
})

export const Wear = Command.define('Wear', {
  args: { day: Day, pieceIds: Schema.Array(PieceId), proposal: Schema.Option(ProposalRef) },
  messages: [Message.SucceededWear, Message.FailedWear],
  execute: ({ day, pieceIds, proposal }) =>
    Effect.gen(function* () {
      const payload = Option.match(proposal, {
        onNone: () => ({ pieceIds }),
        onSome: (ref) => ({ pieceIds, proposal: ref }),
      })
      const worn = yield* (yield* (yield* StyldClient).api).worn.wearPieces({
        params: { day },
        payload: { operationId: yield* drawOperationId(), ...payload },
      })
      return Message.SucceededWear({ pieceIds: worn.pieceIds })
    }).pipe(Effect.orElseSucceed(() => Message.FailedWear())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>

const unavailable = Result.fail('Unavailable' as const)

/** Opening Home: today is read again, and where they left off is kept on screen while it is asked for again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.combine<Model, Message, StyldClient>(model, [
    (current) => ({
      model: modifyFields(current, { motion: () => TableMotion.Still() }),
      commands: [DetermineDay()],
    }),
    Update.refresh<Model, Message, Option.Option<Photo>, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.favourite),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, favourite: FavouriteData) => modifyFields(current, { favourite: () => favourite }),
      load: ReadFavourite(),
    }),
    Update.refresh<Model, Message, Tray, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.tray),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, tray: TrayData) => modifyFields(current, { tray: () => tray }),
      load: ReadTray(),
    }),
    Update.refresh<Model, Message, Feed, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.feed),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, feed: FeedData) => modifyFields(current, { feed: () => feed }),
      load: ReadFeed(),
    }),
  ])

/** The season a day's outfit is for, by its month where Styld's people live (the northern hemisphere): winter from
 * December to February, spring to May, summer to August, autumn to November (T-12). */
export const briefFor = (day: Day): OutfitBrief => {
  const month = Number(day.slice(5, 7))
  if (month === 12 || month <= 2) return { season: 'winter' }
  if (month <= 5) return { season: 'spring' }
  return month <= 8 ? { season: 'summer' } : { season: 'autumn' }
}

/** The proposal on the table, when the run has one. */
const currentProposal = (model: Model): Option.Option<OutfitProposal> =>
  Option.flatMap(AsyncData.getData(model.outfits), ({ proposals, at }) => Array.get(proposals, at))

/** The pieces of a list that are still in the wardrobe, in the list's order. */
const piecesOf = (ids: ReadonlyArray<PieceId>, pieces: ReadonlyArray<Piece>): ReadonlyArray<Piece> => {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  return ids.flatMap((id) => Option.toArray(Option.fromNullishOr(byId.get(id))))
}

/** The pieces of the outfit on the table now: what was worn today, else the proposal Spin reached as the person
 * swapped it. */
const tableIds = (model: Model): ReadonlyArray<PieceId> => {
  if (Worn.guards.Worn(model.worn) && model.showsWorn) return model.worn.pieceIds
  return Option.match(model.maybeSwapped, {
    onSome: (pieceIds) => pieceIds,
    onNone: () => Option.match(currentProposal(model), { onNone: () => [], onSome: (proposal) => proposal.pieceIds }),
  })
}

/** The outfit on the table now: what was worn today, else the proposal Spin reached, with any piece swapped. */
export const tableOutfit = (model: Model, pieces: ReadonlyArray<Piece>): ReadonlyArray<Piece> =>
  piecesOf(tableIds(model), pieces)

/** Whether today's worn outfit is the one on the table. */
export const showsWornOutfit = (model: Model) => Worn.guards.Worn(model.worn) && model.showsWorn

/** Whether the outfit on the table offers to swap one of its pieces: it is a proposal, not what was worn, and every
 * other piece fits the engine's locks. */
export const canSwap = (model: Model, outfit: ReadonlyArray<Piece>) =>
  AsyncData.isSuccess(model.outfits) && !showsWornOutfit(model) && outfit.length >= 2 && outfit.length - 1 <= mostLocked

/** The run as it is after a batch came: the first batch starts it, a later one adds to it. */
const withBatch = (outfits: OutfitsData, batch: OutfitProposals): Outfits =>
  Option.match(AsyncData.getData(outfits), {
    onNone: () => ({ ...batch, at: 0, refilling: false }),
    onSome: (run) => ({
      ...run,
      proposals: [...run.proposals, ...batch.proposals],
      missing: batch.missing,
      exhausted: batch.exhausted || batch.proposals.length === 0,
      refilling: false,
    }),
  })

/** Ask for a new run, unless the day is not known yet. */
const startRun = (model: Model): UpdateReturn =>
  Option.match(model.maybeDay, {
    onNone: () => ({ model }),
    onSome: (day) => ({
      model: modifyFields(model, {
        outfits: () => AsyncData.Loading(),
        maybeSwapped: () => Option.none(),
        swap: () => Swap.Idle(),
      }),
      commands: [MakeOutfits({ day, brief: briefFor(day), session: Option.none(), seen: [] })],
    }),
  })

/** Spin: the next proposal, more asked for while a few are left, and back to the first once the rules have no more. */
const spin = (model: Model): UpdateReturn => {
  const run = AsyncData.getData(model.outfits)
  if (Option.isNone(run) || Option.isNone(model.maybeDay)) return { model }
  const { proposals, at, exhausted, refilling, session } = run.value
  const next = at + 1 < proposals.length ? at + 1 : 0
  const refill = !exhausted && !refilling && proposals.length - next - 1 < refillAt
  const outfits = OutfitsData.Success({ data: { ...run.value, at: next, refilling: refilling || refill } })
  return {
    model: modifyFields(model, {
      outfits: () => outfits,
      showsWorn: () => false,
      maybeSwapped: () => Option.none(),
      swap: () => Swap.Idle(),
      worn: () => Worn.NotYet(),
      motion: () => TableMotion.Spun(),
    }),
    commands: refill
      ? [
          MakeOutfits({
            day: model.maybeDay.value,
            brief: briefFor(model.maybeDay.value),
            session: Option.some(session),
            seen: proposals.map(({ key }) => key),
          }),
        ]
      : [],
  }
}

/** Swap one piece: ask for outfits that keep every other piece, none of them one already shown or the one on the table.
 */
const swapPiece = (model: Model, pieceId: PieceId, pieceIds: ReadonlyArray<PieceId>): UpdateReturn => {
  const run = AsyncData.getData(model.outfits)
  const lockedPieceIds = pieceIds.filter((id) => id !== pieceId)
  if (
    Option.isNone(run) ||
    Option.isNone(model.maybeDay) ||
    showsWornOutfit(model) ||
    Worn.guards.Saving(model.worn) ||
    Swap.guards.Swapping(model.swap) ||
    !pieceIds.includes(pieceId) ||
    Array.isReadonlyArrayEmpty(lockedPieceIds) ||
    lockedPieceIds.length > mostLocked
  ) {
    return { model }
  }
  const from = outfitKeyOf(pieceIds)
  const seen = Array.takeRight(Array.dedupe([...run.value.proposals.map(({ key }) => key), from]), mostSeen)
  return {
    model: modifyFields(model, { swap: () => Swap.Swapping({ pieceId, from }) }),
    commands: [
      SwapPiece({
        day: model.maybeDay.value,
        brief: briefFor(model.maybeDay.value),
        session: run.value.session,
        lockedPieceIds,
        seen,
        pieceId,
        from,
      }),
    ],
  }
}

/** The swap that came: of the outfits that put something else in the swapped piece's place, the first that adds the
 * fewest pieces to the rest takes the table; when none came, the note says so. A swap the table has since moved on
 * from is dropped. */
const swapped = (
  model: Model,
  pieceId: PieceId,
  from: OutfitKey,
  proposals: ReadonlyArray<OutfitProposal>,
): UpdateReturn => {
  if (!isAwaitedSwap(model, pieceId, from)) {
    return { model }
  }
  const kept = tableIds(model).length - 1
  const without = proposals.filter(
    (proposal) => !proposal.pieceIds.includes(pieceId) && proposal.pieceIds.length > kept,
  )
  const fewest = Array.sort(
    without,
    Order.mapInput(Order.Number, (proposal: OutfitProposal) => proposal.pieceIds.length),
  )
  return Option.match(Array.head(fewest), {
    onNone: () => ({ model: modifyFields(model, { swap: () => Swap.NoOther({ pieceId }) }) }),
    onSome: (proposal) => ({
      model: modifyFields(model, { maybeSwapped: () => Option.some(proposal.pieceIds), swap: () => Swap.Idle() }),
    }),
  })
}

/** Whether a swap's answer is the one the table waits for, from the outfit still on it. */
const isAwaitedSwap = (model: Model, pieceId: PieceId, from: OutfitKey) =>
  Swap.guards.Swapping(model.swap) &&
  model.swap.pieceId === pieceId &&
  model.swap.from === from &&
  outfitKeyOf(tableIds(model)) === from

/** The proposal on the table as Wear this reports it: its run, its place in the run, and whether it was changed. */
const proposalRef = (model: Model, pieceIds: ReadonlyArray<PieceId>): Option.Option<ProposalRef> =>
  Option.flatMap(AsyncData.getData(model.outfits), (run) =>
    Option.map(currentProposal(model), (proposal) => ({
      session: run.session,
      mode: 'fast' as const,
      position: run.at,
      edited: proposal.key !== outfitKeyOf(pieceIds),
    })),
  )

const wear = (model: Model, pieceIds: ReadonlyArray<PieceId>): UpdateReturn => {
  if (
    Option.isNone(model.maybeDay) ||
    pieceIds.length === 0 ||
    Worn.guards.Saving(model.worn) ||
    Swap.guards.Swapping(model.swap) ||
    showsWornOutfit(model)
  )
    return { model }
  return {
    model: modifyFields(model, { worn: () => Worn.Saving() }),
    commands: [Wear({ day: model.maybeDay.value, pieceIds, proposal: proposalRef(model, pieceIds) })],
  }
}

/** A new day, or a run that never came, starts a run; otherwise the run on the table stays. */
const dayDetermined = (model: Model, day: Day): UpdateReturn => {
  const sameDay = Option.contains(model.maybeDay, day)
  const next = sameDay ? model : modifyFields(model, { maybeDay: () => Option.some(day) })
  const keep = sameDay && (AsyncData.isSuccess(model.outfits) || AsyncData.isLoading(model.outfits))
  const started = keep ? { model: next } : startRun(next)
  return { ...started, commands: [...(started.commands ?? []), ReadWorn({ day })] }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CompletedDetermineDay: ({ day }) => dayDetermined(model, day),
    SucceededReadWorn: ({ pieceIds }) => ({
      model: modifyFields(model, { worn: () => (pieceIds.length > 0 ? Worn.Worn({ pieceIds }) : Worn.NotYet()) }),
    }),
    FailedReadWorn: () => ({ model: modifyFields(model, { worn: () => Worn.Unread() }) }),
    SucceededReadFeed: ({ feed }) => ({ model: modifyFields(model, { feed: () => FeedData.Success({ data: feed }) }) }),
    FailedReadFeed: () => ({ model: modifyFields(model, { feed: (feed) => AsyncData.settle(feed, unavailable) }) }),
    SucceededReadFavourite: ({ maybePhoto }) => ({
      model: modifyFields(model, { favourite: () => FavouriteData.Success({ data: maybePhoto }) }),
    }),
    FailedReadFavourite: () => ({
      model: modifyFields(model, { favourite: (favourite) => AsyncData.settle(favourite, unavailable) }),
    }),
    SucceededReadTray: ({ tray }) => ({ model: modifyFields(model, { tray: () => TrayData.Success({ data: tray }) }) }),
    FailedReadTray: () => ({ model: modifyFields(model, { tray: (tray) => AsyncData.settle(tray, unavailable) }) }),
    SucceededMakeOutfits: ({ batch }) => ({
      model: modifyFields(model, { outfits: (outfits) => OutfitsData.Success({ data: withBatch(outfits, batch) }) }),
    }),
    FailedMakeOutfits: () => ({
      model: modifyFields(model, {
        // A run that cannot grow goes round what it has; one that never started says so.
        outfits: (outfits) =>
          Option.match(AsyncData.getData(outfits), {
            onNone: () => AsyncData.settle(outfits, unavailable),
            onSome: (run) => OutfitsData.Success({ data: { ...run, exhausted: true, refilling: false } }),
          }),
      }),
    }),
    ClickedSpin: () => spin(model),
    ClickedSwapPiece: ({ pieceId, pieceIds }) => swapPiece(model, pieceId, pieceIds),
    SucceededSwapPiece: ({ pieceId, from, proposals }) => swapped(model, pieceId, from, proposals),
    FailedSwapPiece: ({ pieceId, from }) => ({
      model: isAwaitedSwap(model, pieceId, from)
        ? modifyFields(model, { swap: () => Swap.Failed({ pieceId }) })
        : model,
    }),
    ClickedWear: ({ pieceIds }) => wear(model, pieceIds),
    SucceededWear: ({ pieceIds }) => ({
      model: modifyFields(model, {
        worn: () => Worn.Worn({ pieceIds }),
        showsWorn: () => true,
        swap: () => Swap.Idle(),
      }),
    }),
    FailedWear: () => ({ model: modifyFields(model, { worn: () => Worn.Failed() }) }),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    ClickedRetryOutfits: () => startRun(model),
    ClickedRetryWorn: () =>
      Option.match(model.maybeDay, {
        onNone: () => ({ model }),
        onSome: (day) => ({ model: modifyFields(model, { worn: () => Worn.NotYet() }), commands: [ReadWorn({ day })] }),
      }),
  })
