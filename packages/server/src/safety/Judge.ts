import type { CheckReason } from '@styld/protocol'
import { Array, Context, Effect, Layer, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import type { RunClef } from '../capture/Clef.ts'
import { type Picture, ProviderFailed } from '../capture/Providers.ts'

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
  { readonly judge: (content: Content) => Effect.Effect<Verdict, ProviderFailed> }
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

const PictureAnswer = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Struct({ noul: Schema.Number })),
})

/** A picture's verdict from Clef's scores: a minor at 0.3 fails, any harm at 0.85 fails, at 0.5 it is unsure. */
const pictureVerdict = (scores: Readonly<Record<string, number>>): Verdict => {
  const score = (key: keyof typeof pictureQuestions) => scores[key] ?? 0
  if (score('minor') >= 0.3) return { state: 'failed', reason: 'minor', model: 'clef-flash' }
  const harms = (['sexual', 'violence', 'hate', 'selfHarm'] as const).toSorted((a, b) => score(b) - score(a))
  const worst = harms[0] ?? 'sexual'
  if (score(worst) >= 0.85) return { state: 'failed', reason: worst, model: 'clef-flash' }
  if (score(worst) >= 0.5) return { state: 'unsure', reason: worst, model: 'clef-flash' }
  if (score('instructions') >= 0.5) return { state: 'unsure', reason: 'instructions', model: 'clef-flash' }
  return { state: 'passed', reason: null, model: 'clef-flash' }
}

const failed = new ProviderFailed({ provider: 'workers-ai', retryable: true })

/** Llama Guard 3's answer: safe, or the hazard categories it saw. */
const GuardAnswer = Schema.Struct({
  response: Schema.Union([
    Schema.String,
    Schema.Struct({ safe: Schema.Boolean, categories: Schema.optionalKey(Schema.Array(Schema.String)) }),
  ]),
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

/** How long a check waits for a model before it counts as not answered; it is tried again later. */
const patience = '20 seconds'

const live = (runClef: RunClef, runGuard: RunGuard) =>
  ContentJudge.of({
    // Llama Guard has taken 7–16 s while a mood board's ask waited on it: the judging gets its own span and verdict.
    judge: Effect.fn('Styld.Safety.judge')(
      function* (content: Content) {
        const texts = content.texts.filter((text) => text.trim().length > 0)
        const textAnswer =
          texts.length === 0
            ? passed
            : yield* Effect.tryPromise({
                try: () => runGuard({ messages: [{ role: 'user', content: texts.join('\n') }] }),
                catch: () => failed,
              }).pipe(
                Effect.flatMap((raw) =>
                  Schema.decodeUnknownEffect(GuardAnswer)(raw).pipe(Effect.mapError(() => failed)),
                ),
                Effect.map(textVerdict),
              )
        const pictureAnswers = yield* Effect.forEach(
          content.pictures.slice(0, 3),
          (picture) =>
            Effect.tryPromise({
              try: () =>
                runClef({
                  model: 'clef-flash',
                  state: 'A picture someone made public on a fashion app.',
                  images: [{ content_type: picture.contentType, base64: Base64.encode(picture.bytes) }],
                  questions: pictureQuestions,
                }),
              catch: () => failed,
            }).pipe(
              Effect.flatMap((raw) =>
                Schema.decodeUnknownEffect(PictureAnswer)(raw).pipe(Effect.mapError(() => failed)),
              ),
              Effect.map(({ answers }) =>
                pictureVerdict(Object.fromEntries(Object.entries(answers).map(([key, { noul }]) => [key, noul]))),
              ),
            ),
          { concurrency: 3 },
        )
        const verdict = Array.reduce([textAnswer, instructionsIn(texts), ...pictureAnswers], passed, worse)
        yield* Effect.annotateCurrentSpan('styld.safety.verdict', verdict.state)
        return verdict
      },
      Effect.timeoutOrElse({ duration: patience, orElse: () => Effect.fail(failed) }),
    ),
  })

/** The judge of what people make public: Clef-flash on pictures, Llama Guard 3 on words. */
export const contentJudge = (calls: { readonly runClef: RunClef; readonly runGuard: RunGuard }) =>
  Layer.succeed(ContentJudge, live(calls.runClef, calls.runGuard))
