import { type ProviderError, broken, busy } from '../providers/Errors.ts'
import { deadlines, providerCall } from '../providers/Call.ts'
import { chatCost } from '../providers/Costs.ts'
import type { CheckReason } from '@styld/protocol'
import { Array, Context, Effect, Layer, Schema } from 'effect'
import { askClef, imageOf, noulOf, type RunClef } from '../capture/Clef.ts'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import { type Picture } from '../capture/Providers.ts'

/** What something public shows: its words and at most a few of its pictures. */
export interface Content {
  readonly texts: ReadonlyArray<string>
  readonly pictures: ReadonlyArray<Picture>
}

/** What the model decided about it. */
export interface Verdict {
  readonly state: 'passed' | 'unsure' | 'failed'
  readonly reason: CheckReason | null
  readonly model: string
}

/** The model that decides whether something may be public (owner, 2026-10-30: no human queue). */
export class ContentJudge extends Context.Service<
  ContentJudge,
  { readonly judge: (content: Content) => Effect.Effect<Verdict, ProviderError> }
>()('@styld/server/ContentJudge') {}

export const passed: Verdict = { state: 'passed', reason: null, model: 'none' }
const rank = { passed: 0, unsure: 1, failed: 2 } as const

/** The worse of two verdicts: a failure wins over an unsure answer, which wins over a pass. */
export const worse = (left: Verdict, right: Verdict): Verdict => (rank[right.state] > rank[left.state] ? right : left)

/** Words that speak to an AI assistant, which public text has no reason to: they keep it out of discovery. */
const addressesAssistant =
  /\b(ignore|disregard|forget)\b.{0,40}\b(instructions|previous|above|rules)\b|\bsystem prompt\b|\byou are (now )?(chatgpt|claude|an? (ai|assistant))\b/iu

export const instructionsIn = (texts: ReadonlyArray<string>): Verdict =>
  texts.some((text) => addressesAssistant.test(text))
    ? { state: 'unsure', reason: 'instructions', model: 'styld' }
    : passed

/** Clef's questions about a picture: how likely each harm is, from 0 to 1. */
const pictureQuestions = {
  minor: { type: 'noul', instructions: 'A child or young teenager shown sexually, undressed or in underwear' },
  sexual: { type: 'noul', instructions: 'Nudity or sexual content' },
  violence: { type: 'noul', instructions: 'Graphic violence, gore or weapons pointed at someone' },
  hate: { type: 'noul', instructions: 'Hate symbols, or hateful words about a group of people' },
  selfHarm: { type: 'noul', instructions: 'Self-harm' },
  instructions: { type: 'noul', instructions: 'Written text that addresses an AI assistant or gives it orders' },
} as const

/** A picture's verdict from Clef's scores: a minor at 0.3 fails, any harm at 0.85 fails, at 0.5 it is unsure. */
const pictureVerdict = (score: (key: keyof typeof pictureQuestions) => number): Verdict => {
  if (score('minor') >= 0.3) return { state: 'failed', reason: 'minor', model: 'clef-flash' }
  const harms = (['sexual', 'violence', 'hate', 'selfHarm'] as const).toSorted((a, b) => score(b) - score(a))
  const worst = harms[0] ?? 'sexual'
  if (score(worst) >= 0.85) return { state: 'failed', reason: worst, model: 'clef-flash' }
  if (score(worst) >= 0.5) return { state: 'unsure', reason: worst, model: 'clef-flash' }
  if (score('instructions') >= 0.5) return { state: 'unsure', reason: 'instructions', model: 'clef-flash' }
  return { state: 'passed', reason: null, model: 'clef-flash' }
}

/** Llama Guard 3's answer: safe, or the hazard categories it saw, and the tokens it read and wrote. */
const GuardAnswer = Schema.Struct({
  response: Schema.Union([
    Schema.String,
    Schema.Struct({ safe: Schema.Boolean, categories: Schema.optionalKey(Schema.Array(Schema.String)) }),
  ]),
  usage: Schema.optionalKey(
    Schema.Struct({
      prompt_tokens: Schema.optionalKey(Schema.Number),
      completion_tokens: Schema.optionalKey(Schema.Number),
    }),
  ),
})

/** Llama Guard's hazard categories that take text down; the others keep it out of discovery. */
const failingHazards = new Set(['S1', 'S3', 'S4', 'S9', 'S10', 'S11', 'S12'])
const hazardReasons: Readonly<Record<string, CheckReason>> = {
  S1: 'violence',
  S3: 'sexual',
  S4: 'minor',
  S10: 'hate',
  S11: 'selfHarm',
  S12: 'sexual',
}

const textVerdict = (answer: typeof GuardAnswer.Type): Verdict => {
  const response = answer.response
  const unsafe = typeof response === 'string' ? /unsafe/iu.test(response) : !response.safe
  if (!unsafe) return { state: 'passed', reason: null, model: 'llama-guard-3-8b' }
  const categories = typeof response === 'string' ? (response.match(/S\d+/gu) ?? []) : (response.categories ?? [])
  const hazard = categories.find((category) => failingHazards.has(category))
  return hazard === undefined
    ? { state: 'unsure', reason: hazardReasons[categories[0] ?? ''] ?? 'other', model: 'llama-guard-3-8b' }
    : { state: 'failed', reason: hazardReasons[hazard] ?? 'other', model: 'llama-guard-3-8b' }
}

/** The Workers AI binding narrowed to Llama Guard 3. */
export type RunGuard = (input: {
  readonly messages: ReadonlyArray<{ readonly role: 'user'; readonly content: string }>
}) => Promise<unknown>

/** How long a check waits for its models before it counts as not answered; it is tried again later. Each call keeps
 * its own deadline too (`providers/Call.ts`). */
const patience = '20 seconds'

const guardModel = '@cf/meta/llama-guard-3-8b'

/** Llama Guard on the words, as one counted Workers AI call. */
const guarded = (runGuard: RunGuard, metrics: CaptureMetrics['Service'], texts: ReadonlyArray<string>) =>
  providerCall(
    metrics,
    { provider: 'workers-ai', model: guardModel, kind: 'judge', deadline: deadlines.guard, replaySafe: true },
    Effect.tryPromise({
      try: () => runGuard({ messages: [{ role: 'user', content: texts.join('\n') }] }),
      catch: () => busy('workers-ai'),
    }).pipe(
      Effect.flatMap((raw) =>
        Schema.decodeUnknownEffect(GuardAnswer)(raw).pipe(Effect.mapError(() => broken('workers-ai'))),
      ),
    ),
    ({ usage }) => {
      const read = usage?.prompt_tokens ?? 0
      const written = usage?.completion_tokens ?? 0
      return { units: read + written, costMicroUsd: chatCost(guardModel, read, written) }
    },
  ).pipe(Effect.map(textVerdict))

/** Clef on one picture, as one counted call. */
const pictured = (runClef: RunClef, metrics: CaptureMetrics['Service'], picture: Picture) =>
  askClef(runClef, metrics, 'judge', {
    model: 'clef-flash',
    state: 'A picture someone made public on a fashion app.',
    images: [imageOf(picture)],
    questions: pictureQuestions,
  }).pipe(Effect.map((answer) => pictureVerdict((key) => noulOf(answer, key))))

/** The judge of what people make public: Clef-flash on pictures, Llama Guard 3 on words, each call counted. */
export const contentJudge = (calls: {
  readonly runClef: RunClef
  readonly runGuard: RunGuard
  readonly metrics: CaptureMetrics['Service']
}) =>
  Layer.succeed(
    ContentJudge,
    ContentJudge.of({
      // Llama Guard has taken 7–16 s while a mood board's ask waited on it: the judging gets its own span and verdict.
      judge: Effect.fn('Styld.Safety.judge')(
        function* (content: Content) {
          const texts = content.texts.filter((text) => text.trim().length > 0)
          const textAnswer = texts.length === 0 ? passed : yield* guarded(calls.runGuard, calls.metrics, texts)
          const pictureAnswers = yield* Effect.forEach(
            content.pictures.slice(0, 3),
            (picture) => pictured(calls.runClef, calls.metrics, picture),
            { concurrency: 3 },
          )
          const verdict = Array.reduce([textAnswer, instructionsIn(texts), ...pictureAnswers], passed, worse)
          yield* Effect.annotateCurrentSpan('styld.safety.verdict', verdict.state)
          return verdict
        },
        Effect.timeoutOrElse({ duration: patience, orElse: () => Effect.fail(busy('workers-ai')) }),
      ),
    }),
  )
