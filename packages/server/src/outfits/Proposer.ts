import { type ProviderError, refused } from '../providers/Errors.ts'
import { outfitKeyOf } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { structured, type TextMessage } from '../ai/TextModel.ts'
import type { RunChat } from '../ai/WorkersAiFetch.ts'
import type { CaptureMetrics } from '../capture/Metrics.ts'

import { type Brief, validated, type Wearable } from './Rules.ts'

// Thinking (owner, 2026-10-31): a text model proposes outfits from the person's pieces, sent as short references,
// never their ids, photos or notes. The rules check every proposal; Clef ranks what passes. A model that does not
// answer, or answers nothing the rules keep, fails: the person is offered Fast, never given Fast's outfits as
// Thinking's.

/** Thinking's proposals, kept to the rules, and what the model's answer cost. */
export interface Proposed {
  readonly outfits: ReadonlyArray<ReadonlyArray<Wearable>>
  readonly costMicroUsd: number
}

export interface OutfitProposer {
  readonly propose: (request: Brief, count: number) => Effect.Effect<Proposed, ProviderError>
}

/** The most pieces and shown combinations one request sends. */
const mostSent = 150
const mostShownSent = 20

const Answer = Schema.Struct({
  outfits: Schema.Array(Schema.Struct({ pieces: Schema.Array(Schema.String) })),
})

/** What the model is asked to return. */
const answerSchema = {
  type: 'object',
  properties: {
    outfits: {
      type: 'array',
      items: {
        type: 'object',
        properties: { pieces: { type: 'array', items: { type: 'string' } } },
        required: ['pieces'],
      },
    },
  },
  required: ['outfits'],
} as const

const instructions = (count: number) =>
  [
    'You are a stylist putting together outfits from the clothes one person owns.',
    `Propose ${String(count)} different outfits, each as a list of piece refs from the list, and nothing else.`,
    'Each outfit is a top and a bottom (a knit or a hoodie may go over a shirt or a tee), or a one-piece (a dress or',
    'a jumpsuit); for sport or lounging it may be a set instead. Add shoes when there are any, and a layer or',
    'accessories when they help. Keep to at most one loud colour or bold pattern. Every outfit wears all the fixed',
    'pieces. Never propose an outfit already shown, and never use a ref that is not in the list.',
  ].join(' ')

const line = (ref: string, piece: Wearable) =>
  [
    `${ref}: ${piece.type}`,
    piece.name === null ? null : `“${piece.name}”`,
    piece.colours.join('/') || null,
    piece.pattern,
    piece.season,
    piece.occasions.join('/') || null,
  ]
    .filter((part) => part !== null)
    .join('; ')

/** The request's messages, and the refs they gave the pieces. */
export const proposalMessages = (request: Brief, count: number) => {
  const fixedIds = new Set<string>(request.fixed.map(({ id }) => id))
  const pieces = [...request.fixed, ...request.wardrobe.filter(({ id }) => !fixedIds.has(id))].slice(0, mostSent)
  const refOf = new Map<string, string>(pieces.map((piece, at) => [piece.id, `p${String(at + 1)}`]))
  const pieceOf = new Map(pieces.map((piece, at) => [`p${String(at + 1)}`, piece]))
  const shown = [...request.seen].slice(-mostShownSent).map((key) =>
    key
      .split('.')
      .map((id) => refOf.get(id) ?? '?')
      .join('+'),
  )
  const { season, occasion, words } = request.brief
  const messages: ReadonlyArray<TextMessage> = [
    { role: 'system', content: instructions(count) },
    {
      role: 'user',
      content: [
        `Weather: ${season ?? 'any'}. Occasion: ${occasion ?? 'any'}.`,
        words === undefined ? null : `In the person’s words: “${words}”.`,
        `Fixed: ${request.fixed.map(({ id }) => refOf.get(id)).join(', ') || 'none'}.`,
        'Pieces:',
        ...pieces.map((piece) => line(refOf.get(piece.id) ?? '', piece)),
        shown.length === 0 ? null : `Already shown: ${shown.join('; ')}.`,
      ]
        .filter((part) => part !== null)
        .join('\n'),
    },
  ]
  return { messages, pieceOf }
}

/** The model's outfits kept to the rules: the request's own pieces, new combinations only, once each. */
export const keptProposals = (
  request: Brief,
  answer: typeof Answer.Type,
  pieceOf: ReadonlyMap<string, Wearable>,
): ReadonlyArray<ReadonlyArray<Wearable>> => {
  const kept = new Map<string, ReadonlyArray<Wearable>>()
  for (const { pieces } of answer.outfits) {
    const ids = pieces.flatMap((ref) => Option.toArray(Option.fromNullishOr(pieceOf.get(ref)))).map(({ id }) => id)
    const key = outfitKeyOf(ids)
    if (ids.length !== pieces.length || request.seen.has(key) || kept.has(key)) continue
    Option.map(validated(request, ids), (outfit) => kept.set(key, outfit))
  }
  return [...kept.values()]
}

export const nothingKept = () => refused('workers-ai')

/** Thinking's model: the one Styld answers with, which the owner's probe of 31 October found the best at Slovenian and
 * at following instructions. */
export const thinkingModel = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

/** Thinking through a Workers AI chat model. */
export const liveProposer = (run: RunChat, metrics: CaptureMetrics['Service'], model: string): OutfitProposer => ({
  propose: (request, count) => {
    const { messages, pieceOf } = proposalMessages(request, count)
    return structured(run, metrics, { model, kind: 'propose', messages, schema: answerSchema, answer: Answer }).pipe(
      Effect.flatMap(({ answer, costMicroUsd }) => {
        const outfits = keptProposals(request, answer, pieceOf)
        return outfits.length === 0 ? Effect.fail(nothingKept()) : Effect.succeed({ outfits, costMicroUsd })
      }),
    )
  },
})
