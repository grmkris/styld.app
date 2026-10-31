import { Colour, groupOf, Occasion, Pattern, PieceType, Season } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { type CaptureMetrics, counted, prices } from './Metrics.ts'
import {
  type Comparison,
  type HeldCheck,
  type Judgement,
  type Picture,
  ProviderFailed,
  type Route,
  type Scene,
  type Suggestion,
  type TurnComparison,
  type Verdict,
} from './Providers.ts'

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

/** Each garment type as a shop names it, so the model sorts a piece the way a person browsing would look for it. */
const typeCriteria: { readonly [Type in PieceType]: string } & { readonly none: string } = {
  tops: 'A t-shirt, tank top, camisole or casual top',
  shirts: 'A shirt or blouse, with a collar or buttons, or a dressy woven top',
  bodysuits: 'A bodysuit',
  knitwear: 'A knitted jumper, sweater or cardigan',
  hoodies: 'A hoodie or sweatshirt',
  blazers: 'A tailored blazer or suit jacket',
  jackets: 'A jacket: denim, leather, bomber, puffer or rain jacket',
  coats: 'A coat or trench coat, longer than the hips',
  gilets: 'A gilet, waistcoat or padded vest, without sleeves',
  dresses: 'A dress of any length',
  jumpsuits: 'A jumpsuit, playsuit or dungarees',
  jeans: 'Jeans: denim trousers',
  trousers: 'Trousers, chinos, joggers or leggings',
  shorts: 'Shorts',
  skirts: 'A skirt',
  sportswear: 'Sportswear for exercise: sports top, sports bra, sports leggings or tracksuit',
  swimwear: 'Swimwear: swimsuit, bikini or swim shorts',
  loungewear: 'Loungewear or nightwear: pyjamas, nightdress or robe',
  trainers: 'Trainers or sneakers',
  boots: 'Boots or ankle boots',
  heels: 'Shoes with heels',
  flats: 'Flat shoes: ballet flats, loafers, brogues or espadrilles',
  sandals: 'Sandals, sliders or flip-flops',
  bags: 'A bag, backpack or purse',
  belts: 'A belt',
  scarves: 'A scarf or shawl',
  hats: 'A hat, cap or beanie',
  jewellery: 'Jewellery or a watch',
  eyewear: 'Sunglasses or glasses',
  none: 'Not a garment, shoe or accessory',
}

const colourCriteria = Object.fromEntries(Colour.literals.map((colour) => [colour, `Mostly ${colour}`]))

const ask = (
  run: RunClef,
  metrics: CaptureMetrics['Service'],
  kind: 'route' | 'suggest' | 'check' | 'judge' | 'compare' | 'match',
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

/** What the decision model is asked about each cut-out piece: what a shop would call it, and when and for what it is
 * worn (owner, 2026-10-31). */
const suggestQuestions = {
  type: { type: 'choice', instructions: 'What would a clothing shop call this piece?', criteria: typeCriteria },
  season: {
    type: 'choice',
    instructions: 'In which weather is it worn?',
    criteria: { warm: 'Warm weather', cold: 'Cold weather', allYear: 'Any time of year' },
  },
  occasion: {
    type: 'choice',
    instructions: 'What is it most often worn for?',
    criteria: {
      casual: 'Everyday, casual wear',
      smart: 'Smart wear: the office or a nice dinner',
      formal: 'Formal events',
      sport: 'Sport and exercise',
      lounge: 'Lounging at home or sleeping',
    },
  },
  pattern: {
    type: 'choice',
    instructions: 'What is its pattern?',
    criteria: {
      plain: 'Plain, one colour or colour-blocked',
      striped: 'Striped',
      checked: 'Checked, plaid or tartan',
      printed: 'Printed: floral, animal, graphic, dots or logo',
    },
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

/** What the held-up camera asks about a settled frame, and about the last photo when there is one. */
const heldQuestions = (withPrevious: boolean) => ({
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
  ...(withPrevious
    ? { samePrevious: { type: 'noul', instructions: 'Is it the same garment as in the second image?' } }
    : {}),
})

/** What the decision model is asked about a kept cut-out before a clean picture is drawn from it (owner's
 * decision, 30 October: keep it, draw it, or ask for a retake). A face is asked about so none is ever sent on. */
const judgeQuestions = {
  picture: {
    type: 'choice',
    instructions: 'How good is this picture of the garment, to show as its product picture?',
    criteria: {
      ready: 'Clean and whole, as a shop would show it',
      improve: 'The whole garment shows, but crumpled, held, folded or a little cut off',
      repair: 'Parts are missing or covered: holes where hands, hair or a body were, or a large part cut off',
      fragment: 'Only a small part of the garment shows: too little to tell what it looks like',
    },
  },
  face: { type: 'noul', instructions: "Is any part of a person's face visible?" },
} as const

/** What the decision model is asked about a drawn picture beside the real cut-out. */
const compareQuestions = {
  same: { type: 'noul', instructions: 'Is it the same garment as in the second image?' },
  faithful: { type: 'noul', instructions: 'Are its colour, print, logos and details the same as in the second image?' },
} as const

/** What the decision model is asked about a frame of a turn beside the clean picture it ends on: three of the eight
 * dimensions the 30 October spike asked (`meta-hackathon/out/styld-clean-turn/gate2.ts`), the ones its gate kept. */
const turnQuestions = {
  same: {
    type: 'noul',
    instructions: 'Is it the same garment as in the second image, seen from a slightly different angle?',
  },
  colour: { type: 'noul', instructions: 'Is the colour the same as in the second image?' },
  print: { type: 'noul', instructions: 'Is the logo or print the same as in the second image?' },
  // A plain garment has no print to keep: asked so the print floor applies only to garments that have one.
  printed: { type: 'noul', instructions: 'Does the garment in the second image show a logo, text or a print?' },
} as const

const verdicts: ReadonlyArray<Verdict> = ['ready', 'improve', 'repair', 'fragment']

/** The judgement in an answer. Without a readable verdict the cut-out is treated as needing a redraw, and a face is
 * assumed without an answer about it, so nothing unanswered is sent on. */
const judgementOf = (answer: Answer): Judgement => {
  const face = Option.match(Option.fromNullishOr(answer.answers['face']), {
    onNone: () => 1,
    onSome: () => noulOf(answer, 'face'),
  })
  return Option.match(choiceOf(answer, 'picture'), {
    onNone: () => ({ verdict: 'improve', confidence: 0, face }),
    onSome: ({ choice, probabilities }) => ({
      verdict: verdicts.find((verdict) => verdict === choice) ?? 'improve',
      confidence: probabilities[choice] ?? 0,
      face,
    }),
  })
}

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
  // On the person-routing spike's 44 labelled photos (2026-10-31), every one of 10 laid out was answered flat at
  // 0.91 or more; of the rest only two drawers of folded clothes were (0.54 and 0.70), no photo held up or worn.
  scene: {
    type: 'choice',
    instructions: 'How are the clothes shown?',
    criteria: {
      held: "Held up or shown in someone's hands",
      flat: 'Laid out on a bed, table or floor',
      hanging: 'Hanging on hangers, a rail or a hook',
      worn: 'Worn by a person',
      other: 'None of these, such as a product photo',
    },
  },
} as const

const scenes: ReadonlyArray<Scene> = ['held', 'flat', 'hanging', 'worn', 'other']

/** The scene the decision model chose, when it gave it at least even odds. */
const sceneOf = (answer: Answer) =>
  Option.flatMap(choiceOf(answer, 'scene'), ({ choice, probabilities }) =>
    (probabilities[choice] ?? 0) >= 0.5
      ? Option.fromNullishOr(scenes.find((scene) => scene === choice))
      : Option.none(),
  )

const routeOf = (answer: Answer): Route => {
  // Without an answer a person is assumed, which keeps the photo away from background removal.
  const person = Option.match(choiceOf(answer, 'person'), {
    onNone: () => 1,
    onSome: ({ probabilities }) => probabilities['yes'] ?? 0,
  })
  const scene = Option.match(sceneOf(answer), { onNone: () => ({}), onSome: (found) => ({ scene: found }) })
  return Option.match(choiceOf(answer, 'garments'), {
    onNone: (): Route => ({ garments: 'several', confidence: 0, person, ...scene }),
    onSome: ({ choice, probabilities }): Route => ({
      garments: choice === 'none' || choice === 'one' ? choice : 'several',
      confidence: probabilities[choice] ?? 0,
      person,
      ...scene,
    }),
  })
}

/** Clef-flash as Styld's decision model: route a photo, suggest a piece's details, confirm a held garment. */
/** The decision model on clean pictures and turns: a kept cut-out, a drawing beside it, a turn's frame beside its
 * front. */
const pictureChecks = (run: RunClef, metrics: CaptureMetrics['Service']) => ({
  judge: Effect.fn('Styld.Picture.judge')(function* (cutout: Picture) {
    const answer = yield* ask(run, metrics, 'judge', {
      model: 'clef-flash',
      state: 'One piece of clothing cut out of a photo, to show in a wardrobe app.',
      images: [imageOf(cutout)],
      questions: judgeQuestions,
    })
    return judgementOf(answer)
  }),
  compare: Effect.fn('Styld.Picture.compare')(function* (drawn: Picture, real: Picture) {
    const answer = yield* ask(run, metrics, 'compare', {
      model: 'clef-flash',
      state: 'The first image is a generated product picture; the second is a real photo of a garment.',
      images: [imageOf(drawn), imageOf(real)],
      questions: compareQuestions,
    })
    return { same: noulOf(answer, 'same'), faithful: noulOf(answer, 'faithful') } satisfies Comparison
  }),
  // The camera's `samePrevious` question: on two real videos' cut-outs, true pairs scored 0.68–0.89 and different
  // garments at most 0.76 (person-routing spike, 30 October).
  sameGarment: Effect.fn('Styld.Capture.sameGarment')(function* (picture: Picture, other: Picture) {
    const answer = yield* ask(run, metrics, 'match', {
      model: 'clef-flash',
      state: 'Two pictures of clothes, each cut out of a photo or shown alone.',
      images: [imageOf(picture), imageOf(other)],
      questions: { same: { type: 'noul', instructions: 'Is it the same garment as in the second image?' } },
    })
    return noulOf(answer, 'same')
  }),
  compareTurn: Effect.fn('Styld.Turn.compare')(function* (frame: Picture, front: Picture) {
    const answer = yield* ask(run, metrics, 'compare', {
      model: 'clef-flash',
      state:
        'The first image is a frame of a garment turning on a hanger, partly turned; the second is the same product photographed from the front.',
      images: [imageOf(frame), imageOf(front)],
      questions: turnQuestions,
    })
    return {
      same: noulOf(answer, 'same'),
      colour: noulOf(answer, 'colour'),
      print: noulOf(answer, 'print'),
      printed: noulOf(answer, 'printed'),
    } satisfies TurnComparison
  }),
})

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
      questions: heldQuestions(Option.isSome(previous)),
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
  ...pictureChecks(run, metrics),
})

const decodeType = Schema.decodeUnknownOption(PieceType)
const decodeColour = Schema.decodeUnknownOption(Colour)
const decodeSeason = Schema.decodeUnknownOption(Season)
const decodeOccasion = Schema.decodeUnknownOption(Occasion)
const decodePattern = Schema.decodeUnknownOption(Pattern)

/** An occasion counts once the model gives it this much, besides its first choice. */
const alsoWorn = 0.35

/** The answers as a suggestion a person confirms: the type with how sure the model is of its group, a second colour
 * only when the model is fairly sure of it, and every occasion it gives a fair share. */
export const suggestionOf = (answer: Answer): Suggestion => {
  const typed = choiceOf(answer, 'type')
  const type = Option.flatMap(typed, ({ choice }) => decodeType(choice))
  const confidence = Option.match(Option.all([typed, type]), {
    onNone: () => 0,
    onSome: ([{ probabilities }, chosen]) =>
      Object.entries(probabilities)
        .filter(([name]) => Option.exists(decodeType(name), (other) => groupOf(other) === groupOf(chosen)))
        .reduce((sum, [, probability]) => sum + probability, 0),
  })
  const main = Option.flatMap(choiceOf(answer, 'colour'), ({ choice }) => decodeColour(choice))
  const second = Option.flatMap(choiceOf(answer, 'secondColour'), ({ choice, probabilities }) =>
    (probabilities[choice] ?? 0) >= 0.35 ? decodeColour(choice) : Option.none(),
  ).pipe(Option.filter((colour) => Option.getOrUndefined(main) !== colour))
  const occasions = Option.match(choiceOf(answer, 'occasion'), {
    onNone: () => [],
    onSome: ({ choice, probabilities }) =>
      Object.entries(probabilities)
        .filter(([name, probability]) => name === choice || probability >= alsoWorn)
        .toSorted(([, left], [, right]) => right - left)
        .flatMap(([name]) => Option.toArray(decodeOccasion(name))),
  })
  return {
    type: Option.getOrUndefined(type),
    confidence,
    colours: [...Option.toArray(main), ...Option.toArray(second)],
    season: Option.getOrUndefined(Option.flatMap(choiceOf(answer, 'season'), ({ choice }) => decodeSeason(choice))),
    occasions,
    pattern: Option.getOrUndefined(Option.flatMap(choiceOf(answer, 'pattern'), ({ choice }) => decodePattern(choice))),
    // An answer without the question offers the piece as before, preselected.
    whole: Option.match(choiceOf(answer, 'whole'), {
      onNone: () => 0.5,
      onSome: ({ probabilities }) => probabilities['whole'] ?? 0,
    }),
  }
}
