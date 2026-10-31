import {
  type MakeOutfit,
  type OutfitMode,
  type OutfitProposal,
  outfitKeyOf,
  OutfitSession,
  OutfitSlowDown,
  OutfitUnavailable,
  PieceNotFound,
  type ProposalRef,
  ThinkingSpent,
} from '@styld/protocol'
import { Array, Clock, Context, Effect, Option, Order } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import type { Picture } from '../capture/Providers.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import type { Store } from '../wardrobe/Store.ts'
import { judgingPicture, type OutfitJudge } from './Judge.ts'
import type { OutfitProposer } from './Proposer.ts'
import { type Brief, missingOf, proposed, type Wearable } from './Rules.ts'
import type { OutfitStore } from './Store.ts'
import { type Owned, wearablesOf } from './Wearables.ts'

// The outfit engine (owner, 2026-10-31), shared by the website, the assistants and Styld: free at the account's pace,
// Thinking at most `thinkingPerDay` times a day. Fast draws candidates by the rules; Thinking asks the model; Clef
// ranks either. Every batch is counted with its way, latency and cost, so the owner can compare the two.

export interface OutfitParts {
  readonly wardrobe: Store
  readonly days: OutfitStore
  readonly bindings: ImageBindings
  readonly judge: OutfitJudge
  readonly proposer: OutfitProposer
  /** The account's pace: any outfit, and Thinking's tighter one. False when over it. */
  readonly pace: {
    readonly outfit: (accountId: string) => Effect.Effect<boolean>
    readonly thinking: (accountId: string) => Effect.Effect<boolean>
  }
  readonly metrics: CaptureMetrics['Service']
  readonly thinkingPerDay: number
}

/** The most candidates Fast draws for Clef to rank. */
const mostCandidates = 12

/** Clef calls and picture reads at once. */
const concurrency = 6

const unavailable = () => OutfitUnavailable.make({})

/** The UTC day of a time, as the Thinking counter keys it. */
const dayOf = (millis: number) => new Date(millis).toISOString().slice(0, 10)

/** Clef's score for each outfit (none when it could not look) and what the calls cost, judged a few at a time; each
 * piece's picture read once. */
const judged = (parts: OutfitParts, accountId: string, owned: ReadonlyMap<string, Owned>, request: Brief) =>
  Effect.fn('Styld.Outfits.judge')(function* (outfits: ReadonlyArray<ReadonlyArray<Wearable>>) {
    const pieceIds = [...new Set<string>(outfits.flatMap((outfit) => outfit.map(({ id }) => id)))]
    const pictures = new Map<string, Picture>()
    yield* Effect.forEach(
      pieceIds.flatMap((id) => Option.toArray(Option.fromNullishOr(owned.get(id)))),
      (piece) =>
        Effect.map(judgingPicture(parts.bindings, accountId, piece), (picture) =>
          Option.map(picture, (found) => pictures.set(piece.wearable.id, found)),
        ),
      { concurrency, discard: true },
    )
    return yield* Effect.forEach(
      outfits,
      (outfit) => {
        const shown = outfit.flatMap(({ id }) => Option.toArray(Option.fromNullishOr(pictures.get(id))))
        return shown.length === 0 ? Effect.succeed(Option.none()) : parts.judge.judge(shown, request.brief)
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
const candidatesFor = (parts: OutfitParts, input: MakeOutfit, request: Brief, session: string, accountId: string) =>
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
    const thought = yield* parts.proposer.propose(request, input.count + 2).pipe(Effect.mapError(unavailable))
    return { ...thought, exhausted: false }
  })

/** The fixed pieces of a request, anchor first: each the account's own and ready. */
const fixedOf = (input: MakeOutfit, owned: ReadonlyMap<string, Owned>) => {
  const ids = [...new Set([...Option.toArray(Option.fromNullishOr(input.anchorPieceId)), ...input.lockedPieceIds])]
  const fixed = ids.flatMap((id) => Option.toArray(Option.map(Option.fromNullishOr(owned.get(id)), (o) => o.wearable)))
  return fixed.length === ids.length ? Effect.succeed(fixed) : Effect.fail(PieceNotFound.make({}))
}

/** Within the account's pace, and for Thinking within today's count. */
const admitted = (parts: OutfitParts, accountId: string, mode: OutfitMode) =>
  Effect.gen(function* () {
    if (!(yield* parts.pace.outfit(accountId))) return yield* OutfitSlowDown.make({})
    if (mode === 'fast') return
    if (!(yield* parts.pace.thinking(accountId))) return yield* OutfitSlowDown.make({})
    const today = dayOf(yield* Clock.currentTimeMillis)
    const counted = yield* parts.days
      .countThinking(accountId, today, parts.thinkingPerDay)
      .pipe(Effect.mapError(unavailable))
    if (!counted) return yield* ThinkingSpent.make({})
  })

const make = (parts: OutfitParts, crypto: Effect.Success<typeof Crypto.Crypto>) => {
  const newSession = crypto.randomBytes(16).pipe(
    Effect.map((bytes) => OutfitSession.make(`os_${Base64Url.encode(bytes)}`)),
    Effect.mapError(unavailable),
  )
  return {
    /** A ranked batch of new outfits for the account, as asked. */
    make: Effect.fn('Styld.Outfits.make')(function* (input: MakeOutfit) {
      const { accountId } = yield* CurrentAccount
      yield* admitted(parts, accountId, input.mode)
      const started = yield* Clock.currentTimeMillis
      const session = input.session ?? (yield* newSession)
      const read = yield* wearablesOf(parts.wardrobe, accountId).pipe(Effect.mapError(unavailable))
      const owned = new Map<string, Owned>(read.map((piece) => [piece.wearable.id, piece]))
      const fixed = yield* fixedOf(input, owned)
      const request: Brief = {
        wardrobe: [...owned.values()].map(({ wearable }) => wearable),
        fixed,
        brief: input.brief,
        seen: new Set(input.seen),
      }
      const measure = (event: {
        outcome: 'ok' | 'empty' | 'failed'
        judged: boolean
        proposals: number
        cost: number
      }) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          parts.metrics.outfit({
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
      const candidates = yield* candidatesFor(parts, input, request, session, accountId).pipe(
        Effect.tapError(() => measure({ outcome: 'failed', judged: false, proposals: 0, cost: 0 })),
      )
      const scores = yield* judged(parts, accountId, owned, request)(candidates.outfits)
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
    }),
    /** Forget Thinking's counts before yesterday. */
    sweep: Effect.fn('Styld.Outfits.sweep')(function* () {
      const yesterday = dayOf((yield* Clock.currentTimeMillis) - 24 * 60 * 60 * 1000)
      yield* parts.days.sweepBefore(yesterday).pipe(Effect.ignore({ log: true }))
    }),
  }
}

/** The outfit engine for `CurrentAccount`. */
export class Outfits extends Context.Service<Outfits, ReturnType<typeof make>>()('@styld/server/Outfits') {}

/** The engine over its parts. Build it once per isolate. */
export const makeOutfits = (parts: OutfitParts) =>
  Effect.gen(function* () {
    return make(parts, yield* Crypto.Crypto)
  })

/** Count a proposal the person kept: worn today, or kept on a board. */
export const outfitKept = (metrics: CaptureMetrics['Service'], proposal: ProposalRef, outcome: 'worn' | 'kept') =>
  metrics.outfit({ phase: 'keep', outcome, ...proposal })
