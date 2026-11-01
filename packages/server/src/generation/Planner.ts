import { Mood, maximumMoods } from '@styld/protocol'
import { Context, Effect, Option, Schema } from 'effect'
import { structured } from '../ai/TextModel.ts'
import type { RunChat } from '../ai/WorkersAiFetch.ts'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import { ProviderFailed } from '../capture/Providers.ts'

// Make a mood board (owner, 2026-10-31): one sentence picks the person's own pieces that suit it, and up to three
// moods. No picture is drawn: a mood board is made of real clothes. A Workers AI chat model plans it with a JSON
// schema; the person's pieces go to it as short references, never their ids, photos or notes.

/** One of the person's ready pieces, as the plan sees it. */
export interface Wearable {
  readonly ref: string
  readonly name: string
  readonly type: string
  readonly colours: ReadonlyArray<string>
}

export interface Plan {
  readonly picks: ReadonlyArray<string>
  readonly moods: ReadonlyArray<Mood>
}

export interface PlanRequest {
  readonly sentence: string
  readonly wardrobe: ReadonlyArray<Wearable>
}

/** The most pieces a mood board picks, and the fewest that make one. */
export const mostPicks = 12
export const fewestPicks = 2

/** Plans mood boards; none when the sentence asks for nothing Styld makes, or the wardrobe holds too little for it. */
export class MoodPlanner extends Context.Service<
  MoodPlanner,
  { readonly plan: (request: PlanRequest) => Effect.Effect<Option.Option<Plan>, ProviderFailed> }
>()('@styld/server/MoodPlanner') {}

const Answer = Schema.Struct({
  refuse: Schema.Boolean,
  picks: Schema.Array(Schema.String),
  moods: Schema.Array(Schema.String),
})

/** What the model is asked to return. */
export const answerSchema = {
  type: 'object',
  properties: {
    refuse: { type: 'boolean' },
    picks: { type: 'array', items: { type: 'string' } },
    moods: { type: 'array', items: { type: 'string', enum: Mood.literals } },
  },
  required: ['refuse', 'picks', 'moods'],
} as const

const instructions = [
  'You make a fashion mood board for a person from one sentence they wrote, using only the clothes they own.',
  `Pick ${fewestPicks} to ${mostPicks} of the person’s pieces that together carry the mood, by ref, and up to 3 moods`,
  'from the list. Never pick a ref that is not in the list of pieces.',
  'Set refuse to true, with nothing else, if the sentence asks for anything sexual, violent, hateful, a real',
  'person’s likeness, or anything that is not about style and mood.',
].join(' ')

/** The plan's request: the sentence and the person's pieces, one short line each. */
export const planMessages = (request: PlanRequest) => [
  { role: 'system' as const, content: instructions },
  {
    role: 'user' as const,
    content: [
      `Sentence: ${request.sentence}`,
      'Pieces:',
      ...request.wardrobe.map(({ ref, name, type, colours }) => `${ref}: ${name} (${type}; ${colours.join(', ')})`),
    ].join('\n'),
  },
]

const isMood = Schema.is(Mood)

/** The model's answer, kept to what a plan may hold: the person's own pieces, once each, and moods from the list. */
export const planOf = (answer: typeof Answer.Type, request: PlanRequest): Option.Option<Plan> => {
  const refs = new Set(request.wardrobe.map(({ ref }) => ref))
  const picks = [...new Set(answer.picks.filter((ref) => refs.has(ref)))].slice(0, mostPicks)
  if (answer.refuse || picks.length < fewestPicks) return Option.none()
  return Option.some({ picks, moods: [...new Set(answer.moods.filter(isMood))].slice(0, maximumMoods) })
}

export const plannerModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

/** The live planner, through the one text model seam. */
export const livePlanner = (run: RunChat, metrics: CaptureMetrics['Service']): MoodPlanner['Service'] => ({
  plan: (request) =>
    structured(run, metrics, {
      model: plannerModel,
      kind: 'plan',
      messages: planMessages(request),
      schema: answerSchema,
      answer: Answer,
    }).pipe(Effect.map(({ answer }) => planOf(answer, request))),
})
