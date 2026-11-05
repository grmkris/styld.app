import type { PieceType } from '@styld/protocol'
import { Option, Schema } from 'effect'
import type { ClefAnswer } from '../../packages/server/src/providers/ClefCall.ts'

// The question sets `retype.ts` asks Clef about stored pieces of one type, and the type each answer sorts a piece
// into. Pure, so the rule that moves a person's piece is tested apart from the Cloudflare calls.

/** How sure Clef must be before a stored piece moves: a person's piece changes only on a clear answer. */
const moveBar = 0.7

interface Choice {
  readonly criterion: string
  /** The type the answer sorts a piece into; the set's own `from` keeps it where it is, none is only reported. */
  readonly type: PieceType | undefined
}

export interface QuestionSet {
  /** The stored type whose pieces are asked. */
  readonly from: PieceType
  /** The question's name in Clef's request. */
  readonly question: string
  /** The pieces' name in the summary. */
  readonly pieces: string
  readonly instructions: string
  readonly choices: Readonly<Record<string, Choice>>
  /** Clef's `state` for the cut-out alone. */
  readonly state: string
  /** Clef's `state` when the photo the piece was cut from is sent beside its cut-out; none sends no photo. */
  readonly photoState: string | undefined
}

/** The questions, by the argument that picks them. */
export const questionSets = {
  /** P4, Eva's review, 4 November: "I'd split tops and T-shirts into short, long and sleeveless". The migration made
   * every stored `tops` a short-sleeved top. */
  sleeves: {
    from: 'shortSleeveTops',
    question: 'sleeve',
    pieces: 'short-sleeved tops',
    instructions: 'How long are its sleeves?',
    choices: {
      short: { criterion: 'Short sleeves, ending above the elbow, as on a t-shirt', type: 'shortSleeveTops' },
      long: { criterion: 'Long sleeves, reaching the forearm or the wrist', type: 'longSleeveTops' },
      none: { criterion: 'No sleeves: a tank top, a camisole or a top with straps', type: 'sleevelessTops' },
    },
    state: 'One top cut out of a photo of clothes.',
    photoState: undefined,
  },
  /** Owner, 4 November: Eva found leggings and sports bras sorted wrong. The migration made every stored `sportswear` a
   * sport top. `notSport` is reported, never written, since Clef moved race shirts out of sportswear the wrong way
   * before (T-02, 3 November). */
  sport: {
    from: 'sportTops',
    question: 'kind',
    pieces: 'sport tops',
    instructions: 'Which kind of sportswear is the cut-out piece?',
    choices: {
      bra: { criterion: 'A sports bra or bra top', type: 'sportsBras' },
      top: { criterion: 'A top for sport: a t-shirt, tank top or long-sleeved top', type: 'sportTops' },
      bottom: { criterion: 'Leggings, cycling shorts, running shorts or joggers', type: 'sportBottoms' },
      tracksuit: { criterion: 'A tracksuit, ski trousers or a ski suit', type: 'tracksuits' },
      notSport: { criterion: 'Not clothing made for sport', type: undefined },
    },
    state: 'One piece of sportswear cut out of a photo.',
    photoState:
      'The first image is one piece of sportswear cut out of a photo; the second is the photo it was cut from.',
  },
} as const satisfies Record<string, QuestionSet>
export type QuestionSetName = keyof typeof questionSets
export const isQuestionSetName = (name: string): name is QuestionSetName => Object.hasOwn(questionSets, name)

/** The one question asked, as Clef's `questions` take it. */
export const questionsOf = (set: QuestionSet) => ({
  [set.question]: {
    type: 'choice',
    instructions: set.instructions,
    criteria: Object.fromEntries(Object.entries(set.choices).map(([name, { criterion }]) => [name, criterion])),
  },
})

const Answered = Schema.Struct({ choice: Schema.String, probabilities: Schema.Record(Schema.String, Schema.Number) })

export interface QuestionRead {
  /** The set's choice Clef gave, if it gave one of them. */
  readonly choice: string | undefined
  readonly probability: number
  /** The type the piece moves to: only on a sure answer of a type other than the one it has. */
  readonly to: PieceType | undefined
  /** Reported for a look by eye: an answer that neither moves the piece nor surely keeps it. */
  readonly unsure: boolean
}

/** What Clef said of a stored piece, and where that moves it. */
export const readAnswer = (set: QuestionSet, answer: ClefAnswer): QuestionRead => {
  const answered = Schema.decodeUnknownOption(Answered)(answer.answers[set.question])
  const choice = Option.getOrUndefined(
    Option.filter(
      Option.map(answered, (given) => given.choice),
      (name) => Object.hasOwn(set.choices, name),
    ),
  )
  const probability = Option.match(answered, {
    onNone: () => 0,
    onSome: (given) => given.probabilities[given.choice] ?? 0,
  })
  const type = choice === undefined ? undefined : set.choices[choice]?.type
  const sure = probability >= moveBar
  const to = type !== undefined && type !== set.from && sure ? type : undefined
  return { choice, probability, to, unsure: to === undefined && (type !== set.from || !sure) }
}
