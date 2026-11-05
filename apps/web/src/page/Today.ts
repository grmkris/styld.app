import * as SecureRandom from 'effect/crypto/SecureRandom'
import { drawOperationId } from '../OperationIds.ts'
import {
  Day,
  mostLocked,
  mostSeen,
  OutfitBrief,
  outfitKeyOf,
  OutfitKey,
  OutfitProposal,
  OutfitProposals,
  OutfitSession,
  type MakeOutfit,
  type Piece,
  PieceId,
  ProposalRef,
  Slot,
} from '@styld/protocol'
import { Array, Clock, Effect, Option, Order, Result, Schema, Struct } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import * as PickUp from './PickUp.ts'
import * as ShowMe from './ShowMe.ts'
import * as Tombola from './Tombola.ts'
import * as WhatsNew from './WhatsNew.ts'
import * as FirstRun from './FirstRun.ts'

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

/** Today's outfits from the engine (Fast): every proposal of the run so far, best first within each batch, which one
 * is on the table, what the wardrobe lacks, and whether the run can grow. */
export const Outfits = Schema.Struct({
  session: OutfitSession,
  proposals: Schema.Array(OutfitProposal),
  at: Schema.Int,
  missing: Schema.Array(Slot),
  /** Whether the run can grow: more to ask for, more on their way, or no more (Spin goes round what it has). */
  supply: Schema.Literals(['more', 'refilling', 'exhausted']),
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
  /** What the table shows: what was worn today, once there is that, until Spin or the tombola brings a proposal in. */
  onTable: Schema.Literals(['worn', 'proposal']),
  motion: TableMotion,
  /** The outfit on the table after the person swapped one of its pieces, in place of the proposal Spin reached. */
  maybeSwapped: Schema.Option(Schema.Array(PieceId)),
  swap: Swap,
  worn: Worn,
  pickUp: PickUp.Model,
  /** What What's new starts with: asked once, above it. */
  showMe: ShowMe.Model,
  whatsNew: WhatsNew.Model,
  /** The first run over Home, until it is behind the person. */
  firstRun: FirstRun.Model,
  /** What to wear today: the wheel that draws one piece. */
  tombola: Tombola.Model,
  /** The piece drawn and chosen to wear today: every outfit of the run is made around it, until the person goes back
   * to the usual outfits or the day changes. */
  maybeAnchor: Schema.Option(PieceId),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  maybeDay: Option.none(),
  outfits: AsyncData.Idle(),
  onTable: 'worn',
  motion: TableMotion.Still(),
  maybeSwapped: Option.none(),
  swap: Swap.Idle(),
  worn: Worn.NotYet(),
  pickUp: PickUp.init(),
  showMe: ShowMe.init(),
  whatsNew: WhatsNew.init(),
  firstRun: FirstRun.init(),
  tombola: Tombola.init(),
  maybeAnchor: Option.none(),
})

// MESSAGE

export const Message = defineMessageUnion({
  CompletedDetermineDay: { day: Day },
  SucceededReadWorn: { pieceIds: Schema.Array(PieceId) },
  FailedReadWorn: {},
  GotPickUpMessage: { message: PickUp.Message },
  GotShowMeMessage: { message: ShowMe.Message },
  GotWhatsNewMessage: { message: WhatsNew.Message },
  GotFirstRunMessage: { message: FirstRun.Message },
  GotTombolaMessage: { message: Tombola.Message },
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
  ClickedUsualOutfits: {},
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

/** The piece every outfit is made around, when one was chosen. */
const anchored = (anchor: Option.Option<PieceId>) =>
  Option.match(anchor, { onNone: () => ({}), onSome: (anchorPieceId) => ({ anchorPieceId }) })

/** How many outfits one request asks for, and how few left on the table ask for more. */
const batchSize = 6
const refillAt = 2

/** Outfits of the day by the engine's Fast way, asked under a fresh operation. */
const fastOutfits = (request: Omit<MakeOutfit, 'operationId' | 'mode'>) =>
  Effect.gen(function* () {
    return yield* (yield* (yield* StyldClient).api).outfit.makeOutfit({
      payload: { operationId: yield* drawOperationId(), mode: 'fast', ...request },
    })
  })

/** Today's outfits, made by the engine's Fast way, as a new run or more of one.
 */
export const MakeOutfits = Command.define('MakeOutfits', {
  args: {
    day: Day,
    brief: OutfitBrief,
    session: Schema.Option(OutfitSession),
    seen: Schema.Array(OutfitKey),
    anchor: Schema.Option(PieceId),
  },
  messages: [Message.SucceededMakeOutfits, Message.FailedMakeOutfits],
  execute: ({ day, brief, session, seen, anchor }) =>
    Effect.gen(function* () {
      const batch = yield* fastOutfits({
        day,
        brief,
        ...Option.match(session, { onNone: () => ({}), onSome: (value) => ({ session: value }) }),
        ...anchored(anchor),
        lockedPieceIds: [],
        seen,
        count: batchSize,
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
    anchor: Schema.Option(PieceId),
  },
  messages: [Message.SucceededSwapPiece, Message.FailedSwapPiece],
  execute: ({ day, brief, session, lockedPieceIds, seen, pieceId, from, anchor }) =>
    Effect.gen(function* () {
      const batch = yield* fastOutfits({
        day,
        brief,
        session,
        lockedPieceIds,
        seen,
        count: swapCount,
        ...anchored(anchor),
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

const pickUpFold = {
  read: (model: Model) => Option.some(model.pickUp),
  write: (model: Model, pickUp: PickUp.Model) => modifyFields(model, { pickUp: () => pickUp }),
  toParentMessage: (message: PickUp.Message) => Message.GotPickUpMessage({ message }),
}
const foldPickUp = Update.foldChild({ update: PickUp.update, ...pickUpFold })
const enterPickUp = Update.foldChildStep({ update: PickUp.enter, ...pickUpFold })
const whatsNewFold = {
  read: (model: Model) => Option.some(model.whatsNew),
  write: (model: Model, whatsNew: WhatsNew.Model) => modifyFields(model, { whatsNew: () => whatsNew }),
  toParentMessage: (message: WhatsNew.Message) => Message.GotWhatsNewMessage({ message }),
}
const foldWhatsNew = Update.foldChild({ update: WhatsNew.update, ...whatsNewFold })
const foldTombola = Update.foldChild({
  update: Tombola.update,
  read: (model: Model) => Option.some(model.tombola),
  write: (model: Model, tombola: Tombola.Model) => modifyFields(model, { tombola: () => tombola }),
  toParentMessage: (message: Tombola.Message) => Message.GotTombolaMessage({ message }),
  foldOutMessage: Tombola.OutMessage.match<
    Update.StepWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>
  >({
    ChoseWearIt:
      ({ pieceId }) =>
      (stepModel) =>
        startRun(
          modifyFields(stepModel, {
            maybeAnchor: () => Option.some(pieceId),
            onTable: () => 'proposal',
            motion: () => TableMotion.Spun(),
          }),
        ),
  }),
})
const enterWhatsNew = Update.foldChildStep({ update: WhatsNew.enter, ...whatsNewFold })
const refreshWhatsNew = Update.foldChildStep({ update: WhatsNew.refresh, ...whatsNewFold })
const showMeFold = ShowMe.heldBy<Model, Message>((message) => Message.GotShowMeMessage({ message }))
const enterShowMe = Update.foldChildStep({ update: ShowMe.enter, ...showMeFold })
/** A new Show me reads What's new again, in its order. */
const foldShowMe = Update.foldChild({
  update: ShowMe.update,
  ...showMeFold,
  foldOutMessage: ShowMe.OutMessage.match<
    Update.StepWithOutMessage<Model, Message, OutMessage, StyldClient | SecureRandom.SecureRandom>
  >({ ChangedShowMe: () => refreshWhatsNew }),
})

const firstRunFold = FirstRun.heldBy<Model, Message>((message) => Message.GotFirstRunMessage({ message }))
/** An answer in the first run: Home reads Show me again (its card goes, this browser remembers) and What's new in its
 * order. */
const foldFirstRun = Update.foldChild({
  update: FirstRun.update,
  ...firstRunFold,
  foldOutMessage: () => (step: Model) =>
    Update.combine<Model, Message, StyldClient>(step, [enterShowMe, refreshWhatsNew]),
})

/** Opening Home: today is read again, and where they left off is kept on screen while it is asked for again. */
export const enter = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.combine<Model, Message, StyldClient>(model, [
    (current) => ({
      model: modifyFields(current, { motion: () => TableMotion.Still(), tombola: Tombola.shut }),
      commands: [DetermineDay()],
    }),
    enterPickUp,
    enterShowMe,
    enterWhatsNew,
    Update.foldChildStep({ update: FirstRun.enter, ...firstRunFold }),
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
const piecesInOrder = (ids: ReadonlyArray<PieceId>, pieces: ReadonlyArray<Piece>): ReadonlyArray<Piece> => {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  return ids.flatMap((id) => Option.toArray(Option.fromNullishOr(byId.get(id))))
}

/** The pieces of the outfit on the table now: what was worn today, else the proposal Spin reached as the person
 * swapped it. */
const tableIds = (model: Model): ReadonlyArray<PieceId> => {
  if (Worn.guards.Worn(model.worn) && model.onTable === 'worn') return model.worn.pieceIds
  return Option.match(model.maybeSwapped, {
    onSome: (pieceIds) => pieceIds,
    onNone: () => Option.match(currentProposal(model), { onNone: () => [], onSome: (proposal) => proposal.pieceIds }),
  })
}

/** The outfit on the table now: what was worn today, else the proposal Spin reached, with any piece swapped. */
export const tableOutfit = (model: Model, pieces: ReadonlyArray<Piece>): ReadonlyArray<Piece> =>
  piecesInOrder(tableIds(model), pieces)

/** Whether today's worn outfit is the one on the table. */
export const showsWornOutfit = (model: Model) => Worn.guards.Worn(model.worn) && model.onTable === 'worn'

/** Whether the outfit on the table offers to swap one of its pieces: it is a proposal, not what was worn, and every
 * other piece fits the engine's locks. */
export const canSwap = (model: Model, outfit: ReadonlyArray<Piece>) =>
  AsyncData.isSuccess(model.outfits) &&
  !showsWornOutfit(model) &&
  outfit.length >= 2 &&
  outfit.filter((piece) => !Option.contains(model.maybeAnchor, piece.id)).length - 1 <= mostLocked

const supplyOf = (exhausted: boolean): Outfits['supply'] => (exhausted ? 'exhausted' : 'more')

/** The run as it is after a batch came: the first batch starts it, a later one adds to it. */
const withBatch = (outfits: OutfitsData, batch: OutfitProposals): Outfits =>
  Option.match(AsyncData.getData(outfits), {
    onNone: () => ({ ...Struct.omit(batch, ['mode', 'exhausted']), at: 0, supply: supplyOf(batch.exhausted) }),
    onSome: (run) => ({
      ...run,
      proposals: [...run.proposals, ...batch.proposals],
      missing: batch.missing,
      supply: supplyOf(batch.exhausted || batch.proposals.length === 0),
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
      commands: [
        MakeOutfits({ day, brief: briefFor(day), session: Option.none(), seen: [], anchor: model.maybeAnchor }),
      ],
    }),
  })

/** Spin: the next proposal, more asked for while a few are left, and back to the first once the rules have no more. */
const spin = (model: Model): UpdateReturn => {
  const run = AsyncData.getData(model.outfits)
  if (Option.isNone(run) || Option.isNone(model.maybeDay)) return { model }
  const { proposals, at, supply, session } = run.value
  const next = at + 1 < proposals.length ? at + 1 : 0
  const refill = supply === 'more' && proposals.length - next - 1 < refillAt
  const outfits = OutfitsData.Success({ data: { ...run.value, at: next, supply: refill ? 'refilling' : supply } })
  return {
    model: modifyFields(model, {
      outfits: () => outfits,
      onTable: () => 'proposal',
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
            anchor: model.maybeAnchor,
          }),
        ]
      : [],
  }
}

/** Swap one piece: ask for outfits that keep every other piece, none of them one already shown or the one on the table.
 */
const swapPiece = (model: Model, pieceId: PieceId, pieceIds: ReadonlyArray<PieceId>): UpdateReturn => {
  const run = AsyncData.getData(model.outfits)
  // The anchor stays as the engine's anchor, not a lock, and is never swapped out.
  const lockedPieceIds = pieceIds.filter((id) => id !== pieceId && !Option.contains(model.maybeAnchor, id))
  if (
    Option.isNone(run) ||
    Option.isNone(model.maybeDay) ||
    showsWornOutfit(model) ||
    Worn.guards.Saving(model.worn) ||
    Swap.guards.Swapping(model.swap) ||
    !pieceIds.includes(pieceId) ||
    Option.contains(model.maybeAnchor, pieceId) ||
    (Array.isReadonlyArrayEmpty(lockedPieceIds) && Option.isNone(model.maybeAnchor)) ||
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
        anchor: model.maybeAnchor,
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
  const next = sameDay
    ? model
    : modifyFields(model, { maybeDay: () => Option.some(day), maybeAnchor: () => Option.none() })
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
    GotWhatsNewMessage: (got) => foldWhatsNew(model, got.message),
    GotFirstRunMessage: (got) => foldFirstRun(model, got.message),
    GotTombolaMessage: (got) => foldTombola(model, got.message),
    GotPickUpMessage: (got) => foldPickUp(model, got.message),
    GotShowMeMessage: (got) => foldShowMe(model, got.message),
    SucceededMakeOutfits: ({ batch }) => ({
      model: modifyFields(model, { outfits: (outfits) => OutfitsData.Success({ data: withBatch(outfits, batch) }) }),
    }),
    FailedMakeOutfits: () => ({
      model: modifyFields(model, {
        // A run that cannot grow goes round what it has; one that never started says so.
        outfits: (outfits) =>
          Option.match(AsyncData.getData(outfits), {
            onNone: () => AsyncData.settle(outfits, unavailable),
            onSome: (run) => OutfitsData.Success({ data: { ...run, supply: 'exhausted' } }),
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
        onTable: () => 'worn',
        swap: () => Swap.Idle(),
      }),
    }),
    FailedWear: () => ({ model: modifyFields(model, { worn: () => Worn.Failed() }) }),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedPieces() }),
    ClickedRetryOutfits: () => startRun(model),
    ClickedUsualOutfits: () =>
      startRun(modifyFields(model, { maybeAnchor: () => Option.none(), motion: () => TableMotion.Spun() })),
    ClickedRetryWorn: () =>
      Option.match(model.maybeDay, {
        onNone: () => ({ model }),
        onSome: (day) => ({ model: modifyFields(model, { worn: () => Worn.NotYet() }), commands: [ReadWorn({ day })] }),
      }),
  })
