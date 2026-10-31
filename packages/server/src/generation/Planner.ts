import { fewestMoodPictures, Mood, maximumMoods } from '@styld/protocol'
import { Context, Effect, Option, Schema } from 'effect'
import { type CaptureMetrics, counted } from '../capture/Metrics.ts'
import { ProviderFailed } from '../capture/Providers.ts'

// Make a mood board: one sentence becomes two to four picture prompts, the person's pieces that suit it, and up to three
// moods. A Workers AI chat model plans it with a JSON schema; the person's pieces go to it as short references, never
// their ids, photos or notes.

/** One of the person's ready pieces, as the plan sees it. */
export interface Wearable {
  readonly ref: string
  readonly name: string
  readonly category: string
  readonly colours: ReadonlyArray<string>
}

/** A picture to draw, and the pieces (by reference) it shows. */
export interface PlannedPicture {
  readonly prompt: string
  readonly pieces: ReadonlyArray<string>
}

export interface Plan {
  readonly pictures: ReadonlyArray<PlannedPicture>
  readonly picks: ReadonlyArray<string>
  readonly moods: ReadonlyArray<Mood>
}

export interface PlanRequest {
  readonly sentence: string
  readonly wardrobe: ReadonlyArray<Wearable>
  /** How many pictures' credits are held. */
  readonly most: number
}

/** The most pieces a mood board picks, and a picture shows. */
const mostPicks = 6
const mostPiecesInPicture = 2

/** Plans mood boards; none when the sentence asks for nothing Styld makes. */
export class MoodPlanner extends Context.Service<
  MoodPlanner,
  { readonly plan: (request: PlanRequest) => Effect.Effect<Option.Option<Plan>, ProviderFailed> }
>()('@styld/server/MoodPlanner') {}

const Answer = Schema.Struct({
  refuse: Schema.Boolean,
  pictures: Schema.Array(Schema.Struct({ prompt: Schema.String, pieces: Schema.Array(Schema.String) })),
  picks: Schema.Array(Schema.String),
  moods: Schema.Array(Schema.String),
})

/** What the model is asked to return. */
export const answerSchema = {
  type: 'object',
  properties: {
    refuse: { type: 'boolean' },
    pictures: {
      type: 'array',
      items: {
        type: 'object',
        properties: { prompt: { type: 'string' }, pieces: { type: 'array', items: { type: 'string' } } },
        required: ['prompt', 'pieces'],
      },
    },
    picks: { type: 'array', items: { type: 'string' } },
    moods: { type: 'array', items: { type: 'string', enum: Mood.literals } },
  },
  required: ['refuse', 'pictures', 'picks', 'moods'],
} as const

const instructions = [
  'You plan a fashion mood board for a person, from one sentence they wrote and the clothes they own.',
  'Write 2 to 4 picture prompts that evoke the mood: places, light, textures, objects and details, as editorial',
  'fashion photography. A prompt may show up to two of the person’s pieces, named by their ref in `pieces`.',
  'Never depict a real, named or recognisable person, a celebrity or a brand logo; people appear only as anonymous',
  'figures without visible faces. No text in pictures. Write the prompts in English whatever the sentence’s language.',
  'Pick up to 6 of the person’s pieces that suit the mood, by ref, and up to 3 moods from the list.',
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
      ...request.wardrobe.map(
        ({ ref, name, category, colours }) => `${ref}: ${name} (${category}; ${colours.join(', ')})`,
      ),
    ].join('\n'),
  },
]

const isMood = Schema.is(Mood)

/** The model's answer, kept to what a plan may hold: known references, at most `most` pictures and none under two. */
export const planOf = (answer: typeof Answer.Type, request: PlanRequest): Option.Option<Plan> => {
  const refs = new Set(request.wardrobe.map(({ ref }) => ref))
  const pictures = answer.pictures
    .map(({ prompt, pieces }) => ({
      prompt: prompt.trim().slice(0, 600),
      pieces: [...new Set(pieces.filter((ref) => refs.has(ref)))].slice(0, mostPiecesInPicture),
    }))
    .filter(({ prompt }) => prompt.length > 0)
    .slice(0, request.most)
  if (answer.refuse || pictures.length < Math.min(fewestMoodPictures, request.most)) return Option.none()
  return Option.some({
    pictures,
    picks: [...new Set(answer.picks.filter((ref) => refs.has(ref)))].slice(0, mostPicks),
    moods: [...new Set(answer.moods.filter(isMood))].slice(0, maximumMoods),
  })
}

/** The Workers AI binding narrowed to the planning model. */
export type RunPlanner = (input: {
  readonly messages: ReturnType<typeof planMessages>
  readonly response_format: { readonly type: 'json_schema'; readonly json_schema: typeof answerSchema }
}) => Promise<unknown>

export const plannerModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

const Response = Schema.Struct({ response: Schema.Unknown })

/** The live planner. The model may answer JSON as an object or as text; either decodes the same. */
export const livePlanner = (runPlanner: RunPlanner, metrics: CaptureMetrics['Service']): MoodPlanner['Service'] => ({
  plan: (request) =>
    counted(
      metrics,
      Effect.tryPromise({
        try: () =>
          runPlanner({
            messages: planMessages(request),
            response_format: { type: 'json_schema', json_schema: answerSchema },
          }),
        catch: () => new ProviderFailed({ provider: 'workers-ai', retryable: true }),
      }).pipe(
        Effect.flatMap((raw) => Schema.decodeUnknownEffect(Response)(raw)),
        Effect.flatMap(({ response }) =>
          typeof response === 'string'
            ? Schema.decodeUnknownEffect(Schema.fromJsonString(Answer))(response)
            : Schema.decodeUnknownEffect(Answer)(response),
        ),
        Effect.mapError(() => new ProviderFailed({ provider: 'workers-ai', retryable: true })),
        Effect.map((answer) => planOf(answer, request)),
      ),
      { provider: 'workers-ai', model: plannerModel, kind: 'plan' },
      () => ({ units: 1, costMicroUsd: 0 }),
    ),
})

/** Native acceptance's planner: two pictures, the first showing the first piece, and the first three pieces picked;
 * `[[unclear]]` plans nothing. */
export const standInPlanner: MoodPlanner['Service'] = {
  plan: (request) =>
    Effect.succeed(
      request.sentence.includes('[[unclear]]')
        ? Option.none()
        : planOf(
            {
              refuse: false,
              pictures: [
                { prompt: `${request.sentence}, a place`, pieces: request.wardrobe.slice(0, 1).map(({ ref }) => ref) },
                { prompt: `${request.sentence}, a detail`, pieces: [] },
              ],
              picks: request.wardrobe.slice(0, 3).map(({ ref }) => ref),
              moods: [],
            },
            request,
          ),
    ),
}
