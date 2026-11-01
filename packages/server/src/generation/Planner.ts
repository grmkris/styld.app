import { type ProviderError } from '../providers/Errors.ts'
import { Mood, maximumMoods } from '@styld/protocol'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { LanguageModel } from 'effect/ai'
import { providerErrorOf, type TextTask, workersAiModel } from '../ai/LanguageModel.ts'
import { deadlines } from '../providers/Call.ts'
import { textModels } from '../providers/Costs.ts'

// Make a mood board (owner, 2026-10-31): one sentence picks the person's own pieces that suit it, and up to three
// moods. No picture is drawn: a mood board is made of real clothes. A Workers AI chat model plans it as an object of
// `Answer`; the person's pieces go to it as short references, never their ids, photos or notes.

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

/** The planner's model: Llama 3.3 70B, which planned the owner's boards since 31 October. */
const planner: TextTask = { model: textModels.llama70b, kind: 'plan', deadline: deadlines.chat }

/** What the model is asked to answer. */
const Answer = Schema.Struct({
  refuse: Schema.Boolean,
  picks: Schema.Array(Schema.String),
  moods: Schema.Array(Mood),
})

/** An answer as a plan reads it: moods as words, any not on the list left out. */
interface Answered {
  readonly refuse: boolean
  readonly picks: ReadonlyArray<string>
  readonly moods: ReadonlyArray<string>
}

const instructions = [
  'You make a fashion mood board for a person from one sentence they wrote, using only the clothes they own.',
  `Pick ${fewestPicks} to ${mostPicks} of the person’s pieces that together carry the mood, by ref, and up to 3 moods`,
  'from the list. Never pick a ref that is not in the list of pieces.',
  'Set refuse to true, with nothing else, if the sentence asks for anything sexual, violent, hateful, a real',
  'person’s likeness, or anything that is not about style and mood.',
].join(' ')

/** The plan's request: the sentence and the person's pieces, one short line each. */
export const planPrompt = (request: PlanRequest) => [
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
export const planOf = (answer: Answered, request: PlanRequest): Option.Option<Plan> => {
  const refs = new Set(request.wardrobe.map(({ ref }) => ref))
  const picks = [...new Set(answer.picks.filter((ref) => refs.has(ref)))].slice(0, mostPicks)
  if (answer.refuse || picks.length < fewestPicks) return Option.none()
  return Option.some({ picks, moods: [...new Set(answer.moods.filter(isMood))].slice(0, maximumMoods) })
}

/** Plans mood boards; none when the sentence asks for nothing Styld makes, or the wardrobe holds too little for it. */
export class MoodPlanner extends Context.Service<
  MoodPlanner,
  { readonly plan: (request: PlanRequest) => Effect.Effect<Option.Option<Plan>, ProviderError> }
>()('@styld/server/generation/MoodPlanner') {
  /** The planner on its Workers AI model. */
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      return MoodPlanner.of({
        plan: Effect.fn('Styld.Generation.plan')(function* (request: PlanRequest) {
          const answer = yield* model
            .generateObject({ objectName: 'mood_board', prompt: planPrompt(request), schema: Answer })
            .pipe(Effect.mapError(providerErrorOf))
          return planOf(answer.value, request)
        }),
      })
    }),
  ).pipe(Layer.provide(workersAiModel(planner)))
}
