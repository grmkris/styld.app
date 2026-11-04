import { Colour, PieceType } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { CaptureMetrics } from '../../packages/server/src/kernel/Metrics.ts'
import { makeGarmentVision, type RunClef } from '../../packages/server/src/providers/Clef.ts'
import { dataUrl, type Fetch } from '../../packages/server/src/providers/Http.ts'
import { metaBase } from '../../packages/server/src/providers/Meta.ts'
import { prices } from './Ledger.ts'
import type { Spec } from './Manifest.ts'

// Whether a generated garment is good enough to keep (owner, 4 November 2026), judged before it is imported: one
// garment, of the spec's type, in its first colour, with no person, text, hanger or crop. Muse Spark (`muse-spark-1.3`,
// Meta's Standard model, never a Contributor variant that trains on what it sees) answers in a JSON schema; with
// `--judge clef` Cloudflare's Clef-flash, the repo's own cheap judge, answers what it can of the same question.

/** What the judge saw. Clef cannot read text or hangers, so it answers false for them. */
export const Verdict = Schema.Struct({
  garments: Schema.Int,
  type: Schema.NullOr(PieceType),
  colours: Schema.Array(Colour),
  person: Schema.Boolean,
  text: Schema.Boolean,
  hanger: Schema.Boolean,
  cropped: Schema.Boolean,
  notes: Schema.String,
})
export type Verdict = typeof Verdict.Type

/** A judge and what one look costs it, at worst. */
export interface Judge {
  readonly name: 'spark' | 'clef'
  readonly worst: number
  readonly judge: (png: Uint8Array, spec: Spec) => Promise<{ readonly verdict: Verdict; readonly cost: number }>
}

/** The brief's bar: one garment, the spec's type, its first colour among those seen, and nothing else in the picture. */
/** Types that name a use rather than a shape: a judge reads sportswear joggers as trousers, and loungewear as a
 * jumper or trousers, and is right to. */
const uses: ReadonlySet<string> = new Set(['sportswear', 'loungewear'])

/** Whether the judge read the garment as the spec's type: the same, or any shape for a type that names a use. */
const typeFits = (read: string | null, spec: Spec) => read === spec.type || (read !== null && uses.has(spec.type))

export const passes = (verdict: Verdict, spec: Spec) =>
  verdict.garments === 1 &&
  typeFits(verdict.type, spec) &&
  spec.colours[0] !== undefined &&
  verdict.colours.includes(spec.colours[0]) &&
  !verdict.person &&
  !verdict.text &&
  !verdict.hanger &&
  !verdict.cropped

/** What the next attempt is told about this one, one sentence per fault; none when it passed. */
export const failureOf = (verdict: Verdict, spec: Spec): string | undefined => {
  const faults = [
    verdict.garments === 1 ? undefined : 'The last attempt did not show exactly one garment. Show only this one.',
    typeFits(verdict.type, spec) ? undefined : `The last attempt did not read as a ${spec.subcategory}.`,
    spec.colours[0] !== undefined && verdict.colours.includes(spec.colours[0])
      ? undefined
      : `The last attempt's colour was wrong: it must be ${spec.look}.`,
    verdict.person ? 'The last attempt showed part of a person. No person, hands or body.' : undefined,
    verdict.text ? 'The last attempt showed text or a logo. No text, letters or logos.' : undefined,
    verdict.hanger ? 'The last attempt showed a hanger. No hanger.' : undefined,
    verdict.cropped ? 'The last attempt cut part of the garment off. Show all of it, with space around.' : undefined,
  ].filter((fault) => fault !== undefined)
  return faults.length === 0 ? undefined : faults.join(' ')
}

const question = (spec: Spec) =>
  [
    `This picture should show one ${spec.name.toLowerCase()} as a product photo. Judge only what the picture shows.`,
    'garments: how many separate garments it shows (a pair of shoes or gloves is one).',
    'type: the garment type from the list, or null when none fits.',
    'colours: its main colours from the list, at most three, most of the garment first.',
    'person: whether any person, face, hand or other body part shows.',
    'text: whether any text, letters, numbers, logo, label or watermark shows.',
    'hanger: whether a hanger, hook, clip or mannequin shows.',
    'cropped: whether the frame cuts off any part of the garment.',
    'notes: one short sentence on anything else wrong, or an empty string.',
  ].join('\n')

const answerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['garments', 'type', 'colours', 'person', 'text', 'hanger', 'cropped', 'notes'],
  properties: {
    garments: { type: 'integer' },
    type: { type: ['string', 'null'], enum: [...PieceType.literals, null] },
    colours: { type: 'array', items: { type: 'string', enum: [...Colour.literals] } },
    person: { type: 'boolean' },
    text: { type: 'boolean' },
    hanger: { type: 'boolean' },
    cropped: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const Completion = Schema.Struct({
  choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) })),
  usage: Schema.Struct({ prompt_tokens: Schema.Int, completion_tokens: Schema.Int }),
})

/** The most a Spark look may cost: a picture's tokens in and at most `mostOut` reasoning and answer tokens out. */
const mostOut = 2000
export const sparkWorst = Math.ceil(3000 * prices.sparkPerInputToken + mostOut * prices.sparkPerOutputToken)

/** Muse Spark through `fetch` (IPv6 from this machine) with the operator's key. */
export const sparkJudge = (key: string, fetch: Fetch): Judge => ({
  name: 'spark',
  worst: sparkWorst,
  judge: async (png, spec) => {
    const image = dataUrl({ bytes: png, contentType: 'image/png' })
    const response = await fetch(`${metaBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'muse-spark-1.3',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question(spec) },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'garment_check', strict: true, schema: answerSchema },
        },
        reasoning_effort: 'low',
        max_completion_tokens: mostOut,
      }),
    })
    if (!response.ok) throw new Error(`Muse Spark answered ${String(response.status)}`)
    const completion = Schema.decodeUnknownSync(Completion)(await response.json())
    const cost =
      completion.usage.prompt_tokens * prices.sparkPerInputToken +
      completion.usage.completion_tokens * prices.sparkPerOutputToken
    const content = completion.choices[0]?.message.content ?? null
    if (content === null) throw new Error('Muse Spark gave no verdict')
    return { verdict: Schema.decodeUnknownSync(Schema.fromJsonString(Verdict))(content), cost }
  },
})

/** How many garments Clef's route answer counts: several is any number but one. */
const garmentsSeen = { none: 0, one: 1, several: 2 } as const

/** Clef-flash through the Cloudflare REST API: the route question (how many garments, a person) and the piece's own
 * suggestion (type, colours, whether it is whole). */
export const clefJudge = (run: RunClef): Judge => {
  const vision = makeGarmentVision(run, CaptureMetrics.discarding)
  return {
    name: 'clef',
    worst: 100,
    judge: async (png) => {
      const picture = { bytes: png, contentType: 'image/png' as const }
      const [route, suggestion] = await Effect.runPromise(
        Effect.all([vision.route(picture), vision.suggest(picture)], { concurrency: 2 }),
      )
      const verdict: Verdict = {
        garments: garmentsSeen[route.garments],
        type: suggestion.type ?? null,
        colours: suggestion.colours,
        person: route.person >= 0.5,
        text: false,
        hanger: false,
        cropped: suggestion.whole < 0.5,
        notes: 'Clef cannot see text or hangers.',
      }
      return { verdict, cost: 0 }
    },
  }
}

/** What a judge's look is charged: what it reported, or its worst case when it failed after it may have answered. */
export const judgeCharge = (judge: Judge) => ({
  worst: judge.worst,
  cost: (answer: { readonly cost: number }) => answer.cost,
  failed: () => judge.worst,
})
