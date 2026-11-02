import {
  type MakeOutfit,
  type OutfitMode,
  type OutfitProposal,
  OutfitProposals,
  outfitKeyOf,
  OutfitSession,
  CurrentAccount,
  ThinkingUnanswered,
  NotFound,
  type ProposalRef,
  LimitReached,
  Unavailable,
} from '@styld/protocol'
import { Array, Clock, Context, DateTime, Effect, Layer, Option, Order, Schema } from 'effect'
import { CaptureMetrics } from '../kernel/Metrics.ts'
import type { Picture } from '../capture/Providers.ts'
import { newId } from '../kernel/Ids.ts'
import { Media } from '../kernel/Media.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { once } from '../kernel/Receipts.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { judgingPicture, OutfitJudge } from './Judge.ts'
import { Thinking } from './Proposer.ts'
import { type Brief, missingOf, proposed, type Wearable } from './Rules.ts'
import { OutfitStore } from './Store.ts'
import { type Owned, wearablesOf } from './Wearables.ts'

// The outfit engine (owner, 2026-10-31), shared by the website, the assistants and Styld: free at the account's pace,
// Thinking at most `thinkingPerDay` times a day. Fast draws candidates by the rules; Thinking asks the model; Clef
// ranks either. Every batch is counted with its way, latency and cost, so the owner can compare the two. A repeated
// request (the same operation id) answers the same batch from its receipt, and is counted against nothing again.

/** How many times a day each account may ask Thinking (owner, 2026-10-31); Fast still answers after. */
const thinkingPerDay = 50

/** The most candidates Fast draws for Clef to rank. */
const mostCandidates = 12

/** Clef calls and picture reads at once. */
const concurrency = 6

const unavailable = () => Unavailable.make({})

/** Thinking's model gave no usable outfit: Fast may still answer. */
const unanswered = () => ThinkingUnanswered.make({})

/** The UTC day of an instant, as the Thinking counter keys it. */
const dayOf = (now: DateTime.Utc) => DateTime.formatIsoDateUtc(now)

/** The services the engine works through, provided once by the `Outfits` layer. */
type OutfitServices = Media | OutfitJudge | Thinking | Pacing | CaptureMetrics | OutfitStore | WardrobeStore

/** Clef's score for each outfit (none when it could not look) and what the calls cost, judged a few at a time; each
 * piece's picture read once. */
const judged = (accountId: string, owned: ReadonlyMap<string, Owned>, request: Brief) =>
  Effect.fn('Styld.Outfits.judge')(function* (outfits: ReadonlyArray<ReadonlyArray<Wearable>>) {
    const media = yield* Media
    const judge = yield* OutfitJudge
    const pieceIds = [...new Set<string>(outfits.flatMap((outfit) => outfit.map(({ id }) => id)))]
    const pictures = new Map<string, Picture>()
    yield* Effect.forEach(
      pieceIds.flatMap((id) => Option.toArray(Option.fromNullishOr(owned.get(id)))),
      (piece) =>
        Effect.map(judgingPicture(media, accountId, piece), (picture) =>
          Option.map(picture, (found) => pictures.set(piece.wearable.id, found)),
        ),
      { concurrency, discard: true },
    )
    return yield* Effect.forEach(
      outfits,
      (outfit) => {
        const shown = outfit.flatMap(({ id }) => Option.toArray(Option.fromNullishOr(pictures.get(id))))
        return shown.length === 0 ? Effect.succeed(Option.none()) : judge.judge(shown, request.brief)
      },
      { concurrency },
    )
  })

/** The outfits best first: judged ones by their score, then the unjudged in the order they were made. */
const ranked = (
  outfits: ReadonlyArray<ReadonlyArray<Wearable>>,
  scores: ReadonlyArray<Option.Option<{ readonly score: number }>>,
): ReadonlyArray<OutfitProposal> =>
  Array.sort(
    outfits.map((outfit, at) => {
      const score = Option.getOrNull(Option.map(scores[at] ?? Option.none(), ({ score: value }) => value))
      return { key: outfitKeyOf(outfit.map(({ id }) => id)), pieceIds: outfit.map(({ id }) => id), score }
    }),
    Order.mapInput(Order.Number, (proposal: OutfitProposal) => -(proposal.score ?? -1)),
  )

/** Fast's candidates, or Thinking's, and whether the rules have nothing new beyond them. */
const candidatesFor = (input: MakeOutfit, request: Brief, session: string, accountId: string) =>
  Effect.gen(function* () {
    if (input.mode === 'fast') {
      // A day's draws repeat for the account, so today's outfit holds all day; a run without a day draws its own.
      const base = input.day === undefined ? session : `${accountId}:${input.day}`
      const drawn = proposed(request, `${base}:${String(input.seen.length)}`, mostCandidates)
      return {
        outfits: drawn.outfits,
        costMicroUsd: 0,
        exhausted: drawn.exhausted && drawn.outfits.length <= input.count,
      }
    }
    // Nothing new by the rules is nothing to ask the model for.
    if (proposed(request, 'probe', 1).outfits.length === 0) return { outfits: [], costMicroUsd: 0, exhausted: true }
    const thought = yield* (yield* Thinking).propose(request, input.count + 2).pipe(Effect.mapError(unanswered))
    return { ...thought, exhausted: false }
  })

/** The fixed pieces of a request, anchor first: each the account's own and ready. */
const fixedOf = (input: MakeOutfit, owned: ReadonlyMap<string, Owned>) => {
  const ids = [...new Set([...Option.toArray(Option.fromNullishOr(input.anchorPieceId)), ...input.lockedPieceIds])]
  const fixed = ids.flatMap((id) => Option.toArray(Option.map(Option.fromNullishOr(owned.get(id)), (o) => o.wearable)))
  return fixed.length === ids.length ? Effect.succeed(fixed) : Effect.fail(NotFound.make({}))
}

/** Within the account's pace, and for Thinking within today's count. */
const admitted = (accountId: string, mode: OutfitMode) =>
  Effect.gen(function* () {
    const pacing = yield* Pacing
    yield* pacing.account('outfit')
    if (mode === 'fast') return
    yield* pacing.account('thinking')
    const today = dayOf(yield* DateTime.now)
    const counted = yield* (yield* OutfitStore)
      .countThinking(accountId, today, thinkingPerDay)
      .pipe(Effect.mapError(unavailable))
    if (!counted) return yield* LimitReached.make({ limit: 'thinking' })
  })

/** A ranked batch of new outfits for the account, as asked, counted with its way, latency and cost. */
const batchFor = Effect.fnUntraced(function* (accountId: string, input: MakeOutfit) {
  yield* admitted(accountId, input.mode)
  const started = yield* Clock.currentTimeMillis
  const session = input.session ?? OutfitSession.make(yield* newId('os'))
  const read = yield* wearablesOf(yield* WardrobeStore, accountId).pipe(Effect.mapError(unavailable))
  const owned = new Map<string, Owned>(read.map((piece) => [piece.wearable.id, piece]))
  const fixed = yield* fixedOf(input, owned)
  const request: Brief = {
    wardrobe: [...owned.values()].map(({ wearable }) => wearable),
    fixed,
    brief: input.brief,
    seen: new Set(input.seen),
  }
  const metrics = yield* CaptureMetrics
  const measure = (event: { outcome: 'ok' | 'empty' | 'failed'; judged: boolean; proposals: number; cost: number }) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      metrics.outfit({
        phase: 'make',
        mode: input.mode,
        session,
        outcome: event.outcome,
        judged: event.judged,
        milliseconds: now - started,
        proposals: event.proposals,
        costMicroUsd: event.cost,
      }),
    )
  const candidates = yield* candidatesFor(input, request, session, accountId).pipe(
    Effect.tapError(() => measure({ outcome: 'failed', judged: false, proposals: 0, cost: 0 })),
  )
  const scores = yield* judged(accountId, owned, request)(candidates.outfits)
  const proposals = ranked(candidates.outfits, scores).slice(0, input.count)
  const judgeCost = scores.reduce(
    (sum, score) => sum + Option.match(score, { onNone: () => 0, onSome: (s) => s.costMicroUsd }),
    0,
  )
  yield* measure({
    outcome: proposals.length === 0 ? 'empty' : 'ok',
    judged: scores.some(Option.isSome),
    proposals: proposals.length,
    cost: candidates.costMicroUsd + judgeCost,
  })
  return { session, mode: input.mode, proposals, missing: missingOf(request), exhausted: candidates.exhausted }
})

const Answered = Schema.fromJsonString(OutfitProposals)

const make = Effect.map(Effect.context<OutfitServices>(), (context) => ({
  /** A ranked batch of new outfits for the account, as asked; the same operation answers the same batch. */
  make: Effect.fn('Styld.Outfits.make')(function* (input: MakeOutfit) {
    const { accountId } = yield* CurrentAccount
    const { operationId, ...asked } = input
    return yield* once(
      yield* OutfitStore,
      { accountId, operationId, command: 'makeOutfit', input: asked },
      {
        replay: (result) => Schema.decodeUnknownEffect(Answered)(result).pipe(Effect.mapError(unavailable)),
        run: Effect.flatMap(batchFor(accountId, input), (batch) =>
          Effect.map(
            Schema.encodeEffect(Answered)(batch).pipe(Effect.mapError(unavailable)),
            (result) => [batch, result] as const,
          ),
        ),
      },
    )
  }, Effect.provide(context)),
  /** Forget Thinking's counts before yesterday. */
  sweep: Effect.fn('Styld.Outfits.sweep')(function* () {
    const yesterday = dayOf(DateTime.subtract(yield* DateTime.now, { days: 1 }))
    yield* (yield* OutfitStore).sweepBefore(yesterday).pipe(Effect.ignore({ log: true }))
  }, Effect.provide(context)),
}))

/** The outfit engine for `CurrentAccount`, over the application's database and media, Clef, Thinking and the
 * account's pace. */
export class Outfits extends Context.Service<Outfits, Effect.Success<typeof make>>()('@styld/server/outfits/Outfits') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Outfits.of(service)),
  ).pipe(Layer.provide(OutfitStore.layer))
}

/** Count a proposal the person kept: worn today, or kept on a board. */
export const outfitKept = (metrics: CaptureMetrics['Service'], proposal: ProposalRef, outcome: 'worn' | 'kept') =>
  metrics.outfit({ phase: 'keep', outcome, ...proposal })
