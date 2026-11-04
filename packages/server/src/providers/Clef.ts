import { busy, refused, broken } from './Errors.ts'
import { costs } from './Costs.ts'
import { deadlines, providerCall } from './Call.ts'
import { Colour, familyOf, Occasion, Pattern, PieceType, Season } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import type { CaptureMetrics } from '../kernel/Metrics.ts'
import { alternativeOf } from '../capture/GarmentRules.ts'
import {
  type HeldCheck,
  type Judgement,
  type Picture,
  type Route,
  type Scene,
  type Suggestion,
  type TurnComparison,
  type Verdict,
} from '../capture/Providers.ts'

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
export type ClefAnswer = typeof Answer.Type

const failed = (retryable: boolean) => (retryable ? busy('clef') : refused('clef'))

/** A picture as Clef reads it. */
export const imageOf = (picture: Picture) => ({
  content_type: picture.contentType,
  base64: Base64.encode(picture.bytes),
})

const choiceOf = (answer: ClefAnswer, id: string) =>
  Option.flatMap(Option.fromNullishOr(answer.answers[id]), Schema.decodeUnknownOption(Choice))
/** A yes-or-no answer's likelihood of yes, 0 when it is missing. */
export const noulOf = (answer: ClefAnswer, id: string) =>
  Option.match(Option.flatMap(Option.fromNullishOr(answer.answers[id]), Schema.decodeUnknownOption(Noul)), {
    onNone: () => 0,
    onSome: ({ noul }) => noul,
  })

/** Each garment type as a shop names it, so the model sorts a piece the way a person browsing would look for it. */
const typeCriteria: { readonly [Type in PieceType]: string } & { readonly none: string } = {
  // Tops by sleeve (Eva's review, 4 November), each asked by what its sleeves are.
  shortSleeveTops: 'A t-shirt or casual top with short sleeves, not made for sport or swimming',
  longSleeveTops:
    'A t-shirt or casual top with long sleeves, not a shirt, a knit or a hoodie, not made for sport or swimming',
  sleevelessTops:
    'A tank top, camisole or other top without sleeves or with straps, not made for sport or swimming, not a sports bra or bikini top',
  shirts: 'A shirt or blouse, with a collar or buttons, or a dressy woven top',
  bodysuits: 'A bodysuit',
  knitwear: 'A knitted jumper, sweater or cardigan',
  hoodies: 'A hoodie or sweatshirt',
  blazers: 'A tailored blazer or suit jacket',
  jackets: 'A jacket: denim, leather, bomber, puffer or rain jacket',
  coats: 'A coat or trench coat, longer than the hips',
  gilets: 'A gilet, waistcoat or padded vest, without sleeves',
  dresses: 'A dress of any length: a top and a skirt in one piece',
  jumpsuits: 'A jumpsuit, playsuit or dungarees',
  jeans: 'Jeans: denim trousers',
  // Sport against everyday (Eva, 4 November: leggings, sports bras and skirts sorted wrong most): plain leggings are
  // sport bottoms, and every Sport type says what it is not.
  trousers:
    'Everyday trousers: chinos, tailored, wide-leg or cargo trousers or casual joggers, not jeans, leggings, pyjama bottoms or ski trousers',
  shorts: 'Everyday shorts: denim, linen, tailored or casual shorts, not cycling, running or swim shorts',
  skirts: 'A skirt of any length, a skort or a tennis skirt: worn from the waist down, not shorts and not a dress',
  sportsBras:
    'A sports bra or bra top for exercise: stretchy, wide straps or a racerback, not a bikini top or a camisole',
  sportTops:
    'A top made for exercise: a training t-shirt, tank top or long-sleeved top of stretchy, technical or mesh fabric, not a sports bra',
  sportBottoms:
    'Leggings, cycling shorts, running shorts or training joggers: close-fitting or stretchy bottoms for exercise',
  tracksuits: 'A tracksuit, ski trousers or a ski suit',
  sportShoes: 'Shoes made for sport: running shoes, training shoes or indoor court shoes',
  outdoorShoes: 'Hiking boots, walking boots or snow boots',
  swimwear: 'Swimwear: a swimsuit, a bikini top or bottom, or swim shorts, not a sports bra',
  loungewear:
    'Loungewear or nightwear: pyjama tops or bottoms, often striped or with a drawstring, a nightdress or a robe',
  trainers: 'Everyday trainers or sneakers, worn for style rather than sport',
  boots: 'Everyday boots or ankle boots, not hiking or snow boots',
  heels: 'Shoes with heels',
  flats: 'Ballet flats, Mary Janes or espadrilles',
  loafers: 'Loafers or moccasins',
  laceUps: 'Lace-up shoes: oxfords, derbies or brogues',
  sandals: 'Sandals, sliders or flip-flops',
  bags: 'A bag, backpack or purse: something made to carry things in',
  belts: 'A belt',
  scarves: 'A scarf or shawl',
  hats: 'A hat, cap, beanie or hood worn on the head',
  gloves: 'Gloves or mittens',
  socks: 'Socks or tights',
  hairAccessories: 'A hair accessory: hair clip, headband, hairband or scrunchie',
  jewellery: 'Jewellery or a watch: a necklace, earrings, a ring, a bracelet, a brooch or a pin',
  eyewear: 'Sunglasses or glasses',
  none: 'Not a garment, shoe or accessory',
}

const colourCriteria = Object.fromEntries(Colour.literals.map((colour) => [colour, `Mostly ${colour}`]))

/** What one answer cost: its input tokens, at Clef-flash's list price. */
export const clefCost = (answer: ClefAnswer) => {
  const tokens = answer.usage?.input_tokens ?? 0
  return { units: tokens, costMicroUsd: Math.round(tokens * costs.clefFlashPerToken) }
}

/** Ask Clef, counted as one provider call of `kind` with its tokens' cost. */
export const askClef = (
  run: RunClef,
  metrics: CaptureMetrics['Service'],
  kind: 'route' | 'suggest' | 'check' | 'judge' | 'compare' | 'match' | 'outfit',
  request: ClefRequest,
) =>
  providerCall(
    metrics,
    { provider: 'clef', model: 'clef-flash', kind, deadline: deadlines.clef, replaySafe: true },
    Effect.tryPromise({ try: () => run(request), catch: () => failed(true) }).pipe(
      Effect.flatMap((raw) => Schema.decodeUnknownEffect(Answer)(raw).pipe(Effect.mapError(() => broken('clef')))),
    ),
    clefCost,
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
  rain: {
    type: 'choice',
    instructions: 'Is it made for rain?',
    criteria: {
      rain: 'Made for rain: waterproof, such as a rain jacket, a raincoat, wellies or waterproof boots',
      dry: 'Not made for rain',
    },
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
  // By surface, not by what catches the eye: a black snow boot with a beige rubber trim is black (Eva's review, T-02).
  colour: {
    type: 'choice',
    instructions:
      'What colour covers most of its surface? Ignore soles, trims, stitching, logos, buttons and hardware.',
    criteria: colourCriteria,
  },
  secondColour: {
    type: 'choice',
    instructions:
      'Does a second colour cover a large part of its surface, at least a fifth? Soles, trims, stitching, logos, buttons and hardware do not count. Pick none if not.',
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
 * decision, 30 October: draw it, or ask for a retake). Whether a face shows is not asked (owner, 4 November). */
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

/** The judgement in an answer. Without a readable verdict the cut-out is treated as needing a redraw. */
const judgementOf = (answer: ClefAnswer): Judgement =>
  Option.match(choiceOf(answer, 'picture'), {
    onNone: () => ({ verdict: 'improve', confidence: 0 }),
    onSome: ({ choice, probabilities }) => ({
      verdict: verdicts.find((verdict) => verdict === choice) ?? 'improve',
      confidence: probabilities[choice] ?? 0,
    }),
  })

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
const sceneOf = (answer: ClefAnswer) =>
  Option.flatMap(choiceOf(answer, 'scene'), ({ choice, probabilities }) =>
    (probabilities[choice] ?? 0) >= 0.5
      ? Option.fromNullishOr(scenes.find((scene) => scene === choice))
      : Option.none(),
  )

const routeOf = (answer: ClefAnswer): Route => {
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
/** The decision model on clean pictures and turns: a kept cut-out, and a turn's frame beside its front. */
const pictureChecks = (run: RunClef, metrics: CaptureMetrics['Service']) => ({
  judge: Effect.fn('Styld.Picture.judge')(function* (cutout: Picture) {
    const answer = yield* askClef(run, metrics, 'judge', {
      model: 'clef-flash',
      state: 'One piece of clothing cut out of a photo, to show in a wardrobe app.',
      images: [imageOf(cutout)],
      questions: judgeQuestions,
    })
    return judgementOf(answer)
  }),
  // The camera's `samePrevious` question: on two real videos' cut-outs, true pairs scored 0.68–0.89 and different
  // garments at most 0.76 (person-routing spike, 30 October).
  sameGarment: Effect.fn('Styld.Capture.sameGarment')(function* (picture: Picture, other: Picture) {
    const answer = yield* askClef(run, metrics, 'match', {
      model: 'clef-flash',
      state: 'Two pictures of clothes, each cut out of a photo or shown alone.',
      images: [imageOf(picture), imageOf(other)],
      questions: { same: { type: 'noul', instructions: 'Is it the same garment as in the second image?' } },
    })
    return noulOf(answer, 'same')
  }),
  compareTurn: Effect.fn('Styld.Turn.compare')(function* (frame: Picture, front: Picture) {
    const answer = yield* askClef(run, metrics, 'compare', {
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

/** The suggest request: the cut-out alone, or the cut-out first and the photo it was cut from second, so every question
 * stays about the one piece while the photo shows how and for what it is worn (owner, 4 November: Eva's leggings,
 * sports bras and skirts were sorted wrong from their cut-outs alone). */
const suggestRequest = (picture: Picture, source: Option.Option<Picture>): ClefRequest =>
  Option.match(source, {
    onNone: (): ClefRequest => ({
      model: 'clef-flash',
      state: 'One piece cut out of a photo of clothes.',
      images: [imageOf(picture)],
      questions: suggestQuestions,
    }),
    onSome: (photo): ClefRequest => ({
      model: 'clef-flash',
      state:
        'The first image is one piece cut out of the second image, a photo that may show a person wearing it or other clothes. Every question is about the piece in the first image; the photo shows how and for what it is worn.',
      images: [imageOf(picture), imageOf(photo)],
      questions: suggestQuestions,
    }),
  })

export const makeGarmentVision = (run: RunClef, metrics: CaptureMetrics['Service']) => ({
  route: Effect.fn('Styld.Capture.route')(function* (picture: Picture) {
    const answer = yield* askClef(run, metrics, 'route', {
      model: 'clef-flash',
      state,
      images: [imageOf(picture)],
      questions: routeQuestions,
    })
    return routeOf(answer)
  }),
  suggest: Effect.fn('Styld.Capture.suggest')(function* (picture: Picture, source: Option.Option<Picture>) {
    const answer = yield* askClef(run, metrics, 'suggest', suggestRequest(picture, source))
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
    const answer = yield* askClef(run, metrics, 'check', {
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
/** The seasons a piece of the weather Clef named is worn in (T-12): warm weather is spring and summer, cold autumn
 * and winter, and any time of year none, which the wardrobe reads as all year. A migration maps stored pieces the
 * same way. */
const weatherSeasons: Readonly<Record<string, ReadonlyArray<Season>>> = {
  warm: ['spring', 'summer'],
  cold: ['autumn', 'winter'],
}
const decodeOccasion = Schema.decodeUnknownOption(Occasion)
const decodePattern = Schema.decodeUnknownOption(Pattern)

/** An occasion counts once the model gives it this much, besides its first choice. */
const alsoWorn = 0.35

/** The answers as a suggestion a person confirms: the type with how sure the model is of its group, a second colour
 * only when the model is fairly sure of it, and every occasion it gives a fair share. */
const suggestionOf = (answer: ClefAnswer): Suggestion => {
  const typed = choiceOf(answer, 'type')
  const type = Option.flatMap(typed, ({ choice }) => decodeType(choice))
  const confidence = Option.match(Option.all([typed, type]), {
    onNone: () => 0,
    onSome: ([{ probabilities }, chosen]) =>
      Object.entries(probabilities)
        .filter(([name]) => Option.exists(decodeType(name), (other) => familyOf(other) === familyOf(chosen)))
        .reduce((sum, [, probability]) => sum + probability, 0),
  })
  const alternative = Option.flatMap(Option.all([typed, type]), ([{ probabilities }, chosen]) =>
    alternativeOf(
      chosen,
      Object.entries(probabilities).flatMap(([name, share]) =>
        Option.toArray(Option.map(decodeType(name), (other) => [other, share] as const)),
      ),
    ),
  )
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
    alternative: Option.getOrUndefined(alternative),
    confidence,
    colours: [...Option.toArray(main), ...Option.toArray(second)],
    seasons: Option.match(choiceOf(answer, 'season'), {
      onNone: () => [],
      onSome: ({ choice }) => weatherSeasons[choice] ?? [],
    }),
    rainproof: Option.exists(choiceOf(answer, 'rain'), ({ choice }) => choice === 'rain'),
    occasions,
    pattern: Option.getOrUndefined(Option.flatMap(choiceOf(answer, 'pattern'), ({ choice }) => decodePattern(choice))),
    // An answer without the question offers the piece as before, preselected.
    whole: Option.match(choiceOf(answer, 'whole'), {
      onNone: () => 0.5,
      onSome: ({ probabilities }) => probabilities['whole'] ?? 0,
    }),
  }
}
