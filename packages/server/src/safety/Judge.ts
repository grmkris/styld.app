import { type ProviderError, broken, busy } from '../providers/Errors.ts'
import { deadlines } from '../providers/Call.ts'
import { textModels } from '../providers/Costs.ts'
import type { CheckReason } from '@styld/protocol'
import { Array, Context, Effect, Layer, Option, Schema } from 'effect'
import { LanguageModel } from 'effect/ai'
import { providerErrorOf, type TextTask, workersAiModel } from '../ai/LanguageModel.ts'
import { askClef, imageOf, noulOf, type RunClef } from '../providers/Clef.ts'
import { CaptureMetrics } from '../kernel/Metrics.ts'
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

/** @internal Exported for its tests. */
export const passed: Verdict = { state: 'passed', reason: null, model: 'none' }
const rank = { passed: 0, unsure: 1, failed: 2 } as const

/** The worse of two verdicts: a failure wins over an unsure answer, which wins over a pass. */
export const worse = (left: Verdict, right: Verdict): Verdict => (rank[right.state] > rank[left.state] ? right : left)

/** Words that speak to an AI assistant, which public text has no reason to: they keep it out of discovery. */
const addressesAssistant =
  /\b(ignore|disregard|forget)\b.{0,40}\b(instructions|previous|above|rules)\b|\bsystem prompt\b|\byou are (now )?(chatgpt|claude|an? (ai|assistant))\b/iu

/** @internal Exported for its tests. */
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

/** Llama Guard 3's answer as an object: safe, or the hazard categories it saw. Its text answer is `safe`, or `unsafe`
 * and the categories. */
const GuardObject = Schema.fromJsonString(
  Schema.Struct({ safe: Schema.Boolean, categories: Schema.optionalKey(Schema.Array(Schema.String)) }),
)
const decodeGuardObject = Schema.decodeUnknownOption(GuardObject)

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

/** Llama Guard's text answer: `safe`, or `unsafe` and, on the next line, the categories it saw. */
const guardText = /^\s*(?:(?<safe>safe)|unsafe(?:\s*\n\s*(?<categories>S\d+(?:\s*,\s*S\d+)*))?)\s*$/iu

interface GuardAnswer {
  readonly safe: boolean
  readonly categories: ReadonlyArray<string>
}

/** Llama Guard's answer in one of its two formats; none for anything else (an empty or cut-off answer, an apology),
 * which is no verdict at all. */
const guardAnswer = (answer: string): Option.Option<GuardAnswer> =>
  Option.orElse(
    Option.map(decodeGuardObject(answer), ({ safe, categories }) => ({ safe, categories: categories ?? [] })),
    () =>
      Option.map(Option.fromNullishOr(guardText.exec(answer)?.groups), (groups) => ({
        safe: groups['safe'] !== undefined,
        categories: groups['categories']?.split(',').map((category) => category.trim().toUpperCase()) ?? [],
      })),
  )

/** @internal Exported for its tests. Llama Guard's verdict on the words. An answer in neither of its formats is a
 * Broken provider answer: the check stays pending and is asked again, and is never passed. */
export const textVerdict = (answer: string): Effect.Effect<Verdict, ProviderError> =>
  Option.match(guardAnswer(answer), {
    onNone: () => Effect.fail(broken('workers-ai')),
    onSome: ({ safe, categories }): Effect.Effect<Verdict> => {
      if (safe) return Effect.succeed({ state: 'passed', reason: null, model: 'llama-guard-3-8b' })
      const hazard = categories.find((category) => failingHazards.has(category))
      return Effect.succeed(
        hazard === undefined
          ? { state: 'unsure', reason: hazardReasons[categories[0] ?? ''] ?? 'other', model: 'llama-guard-3-8b' }
          : { state: 'failed', reason: hazardReasons[hazard] ?? 'other', model: 'llama-guard-3-8b' },
      )
    },
  })

/** How long a check waits for its models before it counts as not answered; it is tried again later. Each call keeps
 * its own deadline too (`providers/Call.ts`). */
const patience = '20 seconds'

/** Llama Guard 3 reads the words, as one counted Workers AI call. */
const guard: TextTask = { model: textModels.llamaGuard, kind: 'judge', deadline: deadlines.guard }

/** Llama Guard's verdict on the words. */
const guarded = (model: LanguageModel.LanguageModel, texts: ReadonlyArray<string>) =>
  model.generateText({ prompt: [{ role: 'user', content: texts.join('\n') }] }).pipe(
    Effect.mapError(providerErrorOf),
    Effect.flatMap(({ text }) => textVerdict(text)),
  )

/** Clef on one picture, as one counted call. */
const pictured = (runClef: RunClef, metrics: CaptureMetrics['Service'], picture: Picture) =>
  askClef(runClef, metrics, 'judge', {
    model: 'clef-flash',
    state: 'A picture someone made public on a fashion app.',
    images: [imageOf(picture)],
    questions: pictureQuestions,
  }).pipe(Effect.map((answer) => pictureVerdict((key) => noulOf(answer, key))))

/** The judge of what people make public: Clef-flash on pictures, Llama Guard 3 on words, each call counted. */
export const contentJudge = (runClef: RunClef) =>
  Layer.effect(
    ContentJudge,
    Effect.gen(function* () {
      const metrics = yield* CaptureMetrics
      const model = yield* LanguageModel.LanguageModel
      return ContentJudge.of({
        // Llama Guard has taken 7–16 s while a mood board's ask waited on it: the judging gets its own span and
        // verdict.
        judge: Effect.fn('Styld.Safety.judge')(
          function* (content: Content) {
            const texts = content.texts.filter((text) => text.trim().length > 0)
            const textAnswer = texts.length === 0 ? passed : yield* guarded(model, texts)
            const pictureAnswers = yield* Effect.forEach(
              content.pictures.slice(0, 3),
              (picture) => pictured(runClef, metrics, picture),
              { concurrency: 3 },
            )
            const verdict = Array.reduce([textAnswer, instructionsIn(texts), ...pictureAnswers], passed, worse)
            yield* Effect.annotateCurrentSpan('styld.safety.verdict', verdict.state)
            return verdict
          },
          Effect.timeoutOrElse({ duration: patience, orElse: () => Effect.fail(busy('workers-ai')) }),
        ),
      })
    }),
  ).pipe(Layer.provide(workersAiModel(guard)))
