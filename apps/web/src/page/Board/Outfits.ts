import { drawOperationId } from '../../OperationIds.ts'
import {
  Board,
  BoardId,
  type BoardOutfit,
  BoardOutfitId,
  OperationId,
  OutfitKey,
  outfitKeyOf,
  OutfitsAround,
  PieceId,
  ProposalRef,
} from '@styld/protocol'
import { Array, Effect, Option, Predicate, Schema } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../../StyldClient.ts'

// The outfits of a "One piece, many outfits" board (T-10), as cards under its table: Keep makes one a look pinned on the
// board (T-16), Another puts a new outfit in its place, and Another layout lays them all out again in another of the
// layouts (Eva, 4 November 2026). Each card's work is its own; a lost answer is asked again under the same operation
// id, so an outfit is never kept twice.

// MODEL

/** Why a card's last ask did not go through: it failed (and may be asked again), the wardrobe has no other outfit, or
 * the outfit was kept meanwhile. */
export const CardProblem = Schema.Literals(['failed', 'noMore', 'kept'])
export type CardProblem = typeof CardProblem.Type

/** What a card is doing. A failed ask keeps the operation id it used when it may have reached Styld. */
export const CardWork = defineTaggedUnion({
  Keeping: {},
  Replacing: {},
  Failed: {
    asked: Schema.Literals(['keep', 'another']),
    problem: CardProblem,
    operationId: Schema.Option(OperationId),
  },
})
export type CardWork = typeof CardWork.Type

export const Card = Schema.Struct({ outfitId: BoardOutfitId, work: CardWork })
export type Card = typeof Card.Type

/** What Another layout is doing. A failed ask keeps the operation id it used when it may have reached Styld. */
export const LayoutWork = defineTaggedUnion({
  Resting: {},
  Laying: {},
  Failed: { operationId: Schema.Option(OperationId) },
})
export type LayoutWork = typeof LayoutWork.Type

export const Model = Schema.Struct({
  boardId: Schema.String,
  /** The board's outfits as last read, none on a blank board. */
  maybeAround: Schema.Option(OutfitsAround),
  /** The cards doing something; the others rest. */
  cards: Schema.Array(Card),
  /** Every combination shown on this visit, so Another never brings one back. */
  shown: Schema.Array(OutfitKey),
  layout: LayoutWork,
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  maybeAround: Option.none(),
  cards: [],
  shown: [],
  layout: LayoutWork.Resting(),
})

/** The board as last read: its outfits, every one of them now shown. */
export const withBoard = (model: Model, board: Board): Model =>
  modifyFields(model, {
    maybeAround: () => Option.fromNullishOr(board.outfitsAround),
    shown: (shown) =>
      Array.dedupe([
        ...shown,
        ...(board.outfitsAround?.outfits ?? []).map((outfit) => outfitKeyOf(outfit.pieces.map(({ id }) => id))),
      ]),
  })

/** What a card is doing, if anything. */
export const workOf = (model: Model, outfitId: string): Option.Option<CardWork> =>
  Option.map(
    Array.findFirst(model.cards, (card) => card.outfitId === outfitId),
    ({ work }) => work,
  )

// MESSAGE

export const Message = defineMessageUnion({
  ClickedKeep: { outfitId: BoardOutfitId, name: Schema.String },
  SucceededKeep: { outfitId: BoardOutfitId, board: Board },
  FailedKeep: { outfitId: BoardOutfitId, problem: CardProblem, operationId: Schema.Option(OperationId) },
  ClickedAnother: { outfitId: BoardOutfitId },
  SucceededAnother: { outfitId: BoardOutfitId, board: Board },
  FailedAnother: { outfitId: BoardOutfitId, problem: CardProblem, operationId: Schema.Option(OperationId) },
  ClickedAnotherLayout: {},
  SucceededAnotherLayout: { board: Board },
  FailedAnotherLayout: { operationId: Schema.Option(OperationId) },
})
export type Message = typeof Message.Type

/** The board changed: a look is pinned on it, an outfit and its cluster are new, or its layout is. */
export const OutMessage = defineMessageUnion({ ChangedBoard: { board: Board } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** Why an ask failed: refused because the outfit is kept or no other can be made, or failed on the way. */
const problemOf = (error: unknown): CardProblem => {
  if (Predicate.isTagged(error, 'OutfitRefused')) {
    return Predicate.hasProperty(error, 'reason') && error.reason === 'kept' ? 'kept' : 'noMore'
  }
  return 'failed'
}

/** A card's ask under its operation id (the one kept from a failed ask, or a new one): the board as it is after, or
 * why not, keeping the operation id only when the ask may have reached Styld. */
const cardAsk = <Succeeded, Failed>(
  retry: Option.Option<OperationId>,
  ask: (api: Effect.Success<StyldClient['Service']['api']>, operationId: OperationId) => Effect.Effect<Board, unknown>,
  succeeded: (board: Board) => Succeeded,
  failed: (problem: CardProblem, operationId: Option.Option<OperationId>) => Failed,
): Effect.Effect<Succeeded | Failed, never, StyldClient | SecureRandom.SecureRandom> =>
  Effect.gen(function* () {
    const operationId = yield* drawOperationId(retry)
    return yield* Effect.flatMap((yield* StyldClient).api, (api) => ask(api, operationId)).pipe(
      Effect.map((board): Succeeded | Failed => succeeded(board)),
      Effect.catch((error) => {
        const problem = problemOf(error)
        return Effect.succeed(failed(problem, problem === 'failed' ? Option.some(operationId) : Option.none()))
      }),
    )
  }).pipe(Effect.orElseSucceed(() => failed('failed', Option.none())))

const boardIdOf = (boardId: string) => Schema.decodeUnknownEffect(BoardId)(boardId)

/** Keep the outfit as a look pinned on the board, named after the board and its place, counted for the engine. */
export const KeepOutfit = Command.define('KeepOutfit', {
  args: {
    boardId: Schema.String,
    outfitId: BoardOutfitId,
    name: Schema.String,
    pieceIds: Schema.Array(PieceId),
    proposal: ProposalRef,
    operationId: Schema.Option(OperationId),
  },
  messages: [Message.SucceededKeep, Message.FailedKeep],
  execute: ({ boardId, outfitId, name, pieceIds, proposal, operationId: retry }) =>
    cardAsk(
      retry,
      (api, operationId) =>
        Effect.flatMap(boardIdOf(boardId), (id) =>
          api.board.keepLook({
            params: { boardId: id },
            payload: { operationId, name, pieceIds, outfitId, proposal },
          }),
        ).pipe(Effect.map(({ board }) => board)),
      (board) => Message.SucceededKeep({ outfitId, board }),
      (problem, operationId) => Message.FailedKeep({ outfitId, problem, operationId }),
    ),
})

/** Another outfit in this one's place, none of those shown on this visit. */
export const ReplaceOutfit = Command.define('ReplaceOutfit', {
  args: {
    boardId: Schema.String,
    outfitId: BoardOutfitId,
    seen: Schema.Array(OutfitKey),
    operationId: Schema.Option(OperationId),
  },
  messages: [Message.SucceededAnother, Message.FailedAnother],
  execute: ({ boardId, outfitId, seen, operationId: retry }) =>
    cardAsk(
      retry,
      (api, operationId) =>
        Effect.flatMap(boardIdOf(boardId), (id) =>
          api.board.anotherOutfit({ params: { boardId: id, outfitId }, payload: { operationId, seen } }),
        ),
      (board) => Message.SucceededAnother({ outfitId, board }),
      (problem, operationId) => Message.FailedAnother({ outfitId, problem, operationId }),
    ),
})

/** Lay the board's outfits out in another layout, with as many outfits as it holds. */
export const RelayOut = Command.define('RelayOut', {
  args: { boardId: Schema.String, operationId: Schema.Option(OperationId) },
  messages: [Message.SucceededAnotherLayout, Message.FailedAnotherLayout],
  execute: ({ boardId, operationId: retry }) =>
    cardAsk(
      retry,
      (api, operationId) =>
        Effect.flatMap(boardIdOf(boardId), (id) =>
          api.board.anotherLayout({ params: { boardId: id }, payload: { operationId } }),
        ),
      (board) => Message.SucceededAnotherLayout({ board }),
      (_problem, operationId) => Message.FailedAnotherLayout({ operationId }),
    ),
})

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

/** The most recent combinations Another names as shown: the protocol's limit. */
const mostSeenSent = 60

const withWork = (model: Model, outfitId: BoardOutfitId, work: Option.Option<CardWork>): Model =>
  modifyFields(model, {
    cards: (cards) => [
      ...cards.filter((card) => card.outfitId !== outfitId),
      ...Option.toArray(Option.map(work, (doing) => ({ outfitId, work: doing }))),
    ],
  })

/** The operation id a card asks again with: the one its last failed ask of the same kind kept. */
const retryOf = (model: Model, outfitId: string, asked: 'keep' | 'another') =>
  Option.flatMap(workOf(model, outfitId), (work) =>
    CardWork.guards.Failed(work) && work.asked === asked ? work.operationId : Option.none(),
  )

const outfitOf = (model: Model, outfitId: string): Option.Option<readonly [BoardOutfit, number]> =>
  Option.flatMap(model.maybeAround, ({ outfits }) =>
    Option.flatMap(
      Array.findFirstIndex(outfits, (outfit) => outfit.id === outfitId),
      (position) => Option.map(Array.get(outfits, position), (outfit) => [outfit, position] as const),
    ),
  )

/** Whether the card is being asked, or the whole board laid out again. */
const busy = (model: Model, outfitId: string) =>
  LayoutWork.guards.Laying(model.layout) ||
  Option.exists(workOf(model, outfitId), (work) => !CardWork.guards.Failed(work))

const keepClicked = (model: Model, outfitId: BoardOutfitId, name: string): UpdateReturn =>
  Option.match(outfitOf(model, outfitId), {
    onNone: () => ({ model }),
    onSome: ([outfit, position]) =>
      busy(model, outfitId)
        ? { model }
        : {
            model: withWork(model, outfitId, Option.some(CardWork.Keeping())),
            commands: [
              KeepOutfit({
                boardId: model.boardId,
                outfitId,
                name,
                pieceIds: outfit.pieces.map(({ id }) => id),
                proposal: { session: outfit.session, mode: outfit.mode, position, edited: false },
                operationId: retryOf(model, outfitId, 'keep'),
              }),
            ],
          },
  })

const anotherClicked = (model: Model, outfitId: BoardOutfitId): UpdateReturn =>
  busy(model, outfitId) || Option.isNone(outfitOf(model, outfitId))
    ? { model }
    : {
        model: withWork(model, outfitId, Option.some(CardWork.Replacing())),
        commands: [
          ReplaceOutfit({
            boardId: model.boardId,
            outfitId,
            seen: model.shown.slice(-mostSeenSent),
            operationId: retryOf(model, outfitId, 'another'),
          }),
        ],
      }

/** Whether anything on the board is being asked: a card's keep or another, or another layout. */
export const isBusy = (model: Model) =>
  LayoutWork.guards.Laying(model.layout) || model.cards.some(({ work }) => !CardWork.guards.Failed(work))

const anotherLayoutClicked = (model: Model): UpdateReturn =>
  isBusy(model) || !Option.exists(model.maybeAround, ({ anchor }) => anchor !== null)
    ? { model }
    : {
        model: modifyFields(model, { layout: () => LayoutWork.Laying() }),
        commands: [
          RelayOut({
            boardId: model.boardId,
            operationId: LayoutWork.guards.Failed(model.layout) ? model.layout.operationId : Option.none(),
          }),
        ],
      }

const changed = (model: Model, outfitId: BoardOutfitId, board: Board): UpdateReturn => ({
  model: withBoard(withWork(model, outfitId, Option.none()), board),
  outMessage: OutMessage.ChangedBoard({ board }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedKeep: ({ outfitId, name }) => keepClicked(model, outfitId, name),
    SucceededKeep: ({ outfitId, board }) => changed(model, outfitId, board),
    FailedKeep: ({ outfitId, problem, operationId }) => ({
      model: withWork(model, outfitId, Option.some(CardWork.Failed({ asked: 'keep', problem, operationId }))),
    }),
    ClickedAnother: ({ outfitId }) => anotherClicked(model, outfitId),
    SucceededAnother: ({ outfitId, board }) => changed(model, outfitId, board),
    FailedAnother: ({ outfitId, problem, operationId }) => ({
      model: withWork(model, outfitId, Option.some(CardWork.Failed({ asked: 'another', problem, operationId }))),
    }),
    ClickedAnotherLayout: () => anotherLayoutClicked(model),
    // The board's outfits may have changed: the cards start again from rest.
    SucceededAnotherLayout: ({ board }) => ({
      model: withBoard(modifyFields(model, { layout: () => LayoutWork.Resting(), cards: () => [] }), board),
      outMessage: OutMessage.ChangedBoard({ board }),
    }),
    FailedAnotherLayout: ({ operationId }) => ({
      model: modifyFields(model, { layout: () => LayoutWork.Failed({ operationId }) }),
    }),
  })
