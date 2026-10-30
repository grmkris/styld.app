import { Category, Colour, Subcategory, subcategoryFits } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { type CaptureMetrics, counted, prices } from './Metrics.ts'
import { type HeldCheck, type Picture, ProviderFailed, type Route, type Suggestion } from './Providers.ts'

/** A Clef-flash request (Workers AI `@cf/cloudflare/clef-flash`, the System One API). */
export interface ClefRequest {
  readonly model: 'clef-flash'
  readonly state: string
  readonly images: ReadonlyArray<{ readonly content_type: string; readonly base64: string }>
  readonly questions: Readonly<Record<string, object>>
}

/** The Workers AI binding narrowed to Clef-flash. */
export type RunClef = (request: ClefRequest) => Promise<unknown>

const Choice = Schema.Struct({ choice: Schema.String, probabilities: Schema.Record(Schema.String, Schema.Number) })
const Noul = Schema.Struct({ noul: Schema.Number })
const Answer = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Unknown),
  usage: Schema.optionalKey(Schema.Struct({ input_tokens: Schema.optionalKey(Schema.Number) })),
})
type Answer = typeof Answer.Type

const failed = (retryable: boolean) => new ProviderFailed({ provider: 'clef', retryable })

const imageOf = (picture: Picture) => ({ content_type: picture.contentType, base64: Base64.encode(picture.bytes) })

const choiceOf = (answer: Answer, id: string) =>
  Option.flatMap(Option.fromNullishOr(answer.answers[id]), Schema.decodeUnknownOption(Choice))
const noulOf = (answer: Answer, id: string) =>
  Option.match(Option.flatMap(Option.fromNullishOr(answer.answers[id]), Schema.decodeUnknownOption(Noul)), {
    onNone: () => 0,
    onSome: ({ noul }) => noul,
  })

const categoryCriteria = {
  top: 'A top: t-shirt, shirt, blouse, sweater, cardigan, hoodie or tank top',
  bottom: 'A bottom: trousers, jeans, shorts, skirt or leggings',
  dress: 'A dress, or a one-piece such as a jumpsuit',
  outerwear: 'Outerwear: coat, jacket, blazer or vest',
  shoes: 'Shoes of any kind',
  accessory: 'An accessory: bag, belt, hat, scarf, glasses or jewellery',
  none: 'Not a garment, shoe or accessory',
}

const colourCriteria = Object.fromEntries(Colour.literals.map((colour) => [colour, `Mostly ${colour}`]))

const ask = (
  run: RunClef,
  metrics: CaptureMetrics['Service'],
  kind: 'route' | 'suggest' | 'check',
  request: ClefRequest,
) =>
  counted(
    metrics,
    Effect.tryPromise({ try: () => run(request), catch: () => failed(true) }).pipe(
      Effect.timeoutOrElse({ duration: '30 seconds', orElse: () => Effect.fail(failed(true)) }),
      Effect.flatMap((raw) => Schema.decodeUnknownEffect(Answer)(raw).pipe(Effect.mapError(() => failed(false)))),
    ),
    { provider: 'clef', model: 'clef-flash', kind },
    (answer) => {
      const tokens = answer.usage?.input_tokens ?? 0
      return { units: tokens, costMicroUsd: Math.round(tokens * prices.clefFlashPerToken) }
    },
  )

/** What the decision model is asked about each cut-out piece. */
const suggestQuestions = {
  category: { type: 'choice', instructions: 'What is this piece?', criteria: categoryCriteria },
  subcategory: {
    type: 'choice',
    instructions: 'Which kind of piece is it most precisely?',
    criteria: Object.fromEntries(Subcategory.literals.map((name) => [name, name.replaceAll('_', ' ')])),
  },
  colour: { type: 'choice', instructions: 'What is its main colour?', criteria: colourCriteria },
  secondColour: {
    type: 'choice',
    instructions: 'Does it have a clear second colour? Pick none if not.',
    criteria: { ...colourCriteria, none: 'No second colour' },
  },
  whole: {
    type: 'choice',
    instructions: 'What does this cut-out show?',
    criteria: {
      whole: 'One whole garment, shown completely',
      part: 'Part of a garment: cut off, mostly hidden, or a thin strip',
      several: 'More than one garment together',
      notGarment: 'Not clothing',
    },
  },
}

const state = 'A person photographed clothes to add them to their wardrobe.'

/** How many garments a photo shows, and whether a person does: the route's questions. */
const routeQuestions = {
  garments: {
    type: 'choice',
    instructions: 'How many separate garments, shoes or accessories are clearly visible?',
    criteria: { none: 'None', one: 'Exactly one', several: 'Two or more' },
  },
  // Found the person in 26 of 26 photos with one, with one false alarm in 18 without (person-routing spike,
  // 2026-10-30); asked as this two-way choice there, so it is asked the same way here.
  person: {
    type: 'choice',
    instructions: 'Is any part of a person visible: a face, hair, skin, hands, arms or legs?',
    criteria: { yes: 'Yes', no: 'No' },
  },
} as const

const routeOf = (answer: Answer): Route => {
  // Without an answer a person is assumed, which keeps the photo away from background removal.
  const person = Option.match(choiceOf(answer, 'person'), {
    onNone: () => 1,
    onSome: ({ probabilities }) => probabilities['yes'] ?? 0,
  })
  return Option.match(choiceOf(answer, 'garments'), {
    onNone: (): Route => ({ garments: 'several', confidence: 0, person }),
    onSome: ({ choice, probabilities }): Route => ({
      garments: choice === 'none' || choice === 'one' ? choice : 'several',
      confidence: probabilities[choice] ?? 0,
      person,
    }),
  })
}

/** Clef-flash as Styld's decision model: route a photo, suggest a piece's details, confirm a held garment. */
export const makeGarmentVision = (run: RunClef, metrics: CaptureMetrics['Service']) => ({
  route: Effect.fn('Styld.Capture.route')(function* (picture: Picture) {
    const answer = yield* ask(run, metrics, 'route', {
      model: 'clef-flash',
      state,
      images: [imageOf(picture)],
      questions: routeQuestions,
    })
    return routeOf(answer)
  }),
  suggest: Effect.fn('Styld.Capture.suggest')(function* (picture: Picture) {
    const answer = yield* ask(run, metrics, 'suggest', {
      model: 'clef-flash',
      state: 'One piece cut out of a photo of clothes.',
      images: [imageOf(picture)],
      questions: suggestQuestions,
    })
    return suggestionOf(answer)
  }),
  checkHeld: Effect.fn('Styld.Capture.checkHeld')(function* (
    picture: Picture,
    previous: Option.Option<Picture>,
    layout: 'held' | 'flat',
  ) {
    const images = [imageOf(picture), ...Option.toArray(Option.map(previous, imageOf))]
    const scene =
      layout === 'flat'
        ? 'A phone camera looking down at clothes laid flat.'
        : 'A camera frame of someone showing clothes to their phone.'
    const answer = yield* ask(run, metrics, 'check', {
      model: 'clef-flash',
      state: Option.isSome(previous)
        ? `${scene} The first image is the camera frame now; the second is the last garment photographed.`
        : scene,
      images,
      questions: {
        held: {
          type: 'noul',
          // Stillness on the page already shows someone brought it in and holds it still. Asked whether it is
          // "held up", Clef rated a lone tee 0.45; as the main subject 0.92, and a rail of ten 0.02.
          instructions: 'Is exactly one garment the main subject of the picture, fully in view?',
        },
        side: {
          type: 'choice',
          instructions: 'Which side of the garment faces the camera?',
          criteria: { front: 'The front', back: 'The back', unclear: 'Cannot tell' },
        },
        // Clothes lying on a bed behind someone who walked off to fetch the next piece are the main subject
        // too (owner's test, 30 October): a held-up shot needs the hands.
        holding: { type: 'noul', instructions: 'Is a person holding the garment up with their hands?' },
        ...(Option.isSome(previous)
          ? { samePrevious: { type: 'noul', instructions: 'Is it the same garment as in the second image?' } }
          : {}),
      },
    })
    const side = Option.match(choiceOf(answer, 'side'), {
      onNone: (): HeldCheck['side'] => 'unclear',
      onSome: ({ choice }): HeldCheck['side'] => (choice === 'front' || choice === 'back' ? choice : 'unclear'),
    })
    return {
      held: noulOf(answer, 'held'),
      side,
      samePrevious: noulOf(answer, 'samePrevious'),
      holding: noulOf(answer, 'holding'),
    }
  }),
})

const decodeCategory = Schema.decodeUnknownOption(Category)
const decodeSubcategory = Schema.decodeUnknownOption(Subcategory)
const decodeColour = Schema.decodeUnknownOption(Colour)

/** The answers as a suggestion a person confirms: a subcategory only where it fits the category, and a
 * second colour only when the model is fairly sure of it. */
const suggestionOf = (answer: Answer): Suggestion => {
  const category = Option.flatMap(choiceOf(answer, 'category'), ({ choice }) => decodeCategory(choice))
  const confidence = Option.match(choiceOf(answer, 'category'), {
    onNone: () => 0,
    onSome: ({ choice, probabilities }) => probabilities[choice] ?? 0,
  })
  const subcategory = Option.flatMap(choiceOf(answer, 'subcategory'), ({ choice }) => decodeSubcategory(choice)).pipe(
    Option.filter((name) =>
      Option.match(category, { onNone: () => false, onSome: (main) => subcategoryFits(main, name) }),
    ),
  )
  const main = Option.flatMap(choiceOf(answer, 'colour'), ({ choice }) => decodeColour(choice))
  const second = Option.flatMap(choiceOf(answer, 'secondColour'), ({ choice, probabilities }) =>
    (probabilities[choice] ?? 0) >= 0.35 ? decodeColour(choice) : Option.none(),
  ).pipe(Option.filter((colour) => Option.getOrUndefined(main) !== colour))
  return {
    category: Option.getOrUndefined(category),
    confidence,
    subcategory: Option.getOrUndefined(subcategory),
    colours: [...Option.toArray(main), ...Option.toArray(second)],
    // An answer without the question offers the piece as before, preselected.
    whole: Option.match(choiceOf(answer, 'whole'), {
      onNone: () => 0.5,
      onSome: ({ probabilities }) => probabilities['whole'] ?? 0,
    }),
  }
}
