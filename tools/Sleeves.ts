import type { PieceType } from '@styld/protocol'
import { Option, Schema } from 'effect'
import type { ClefAnswer } from '../packages/server/src/providers/Clef.ts'

// The sleeve question `retype-tops.ts` asks Clef about a stored top, and the type its answer sorts the top into. Pure,
// so the rule that moves a person's piece is tested apart from the Cloudflare calls.

/** How sure Clef must be of a sleeve before a stored top moves: a person's piece changes only on a clear answer. */
export const sleeveBar = 0.7

/** Each sleeve as Clef is asked it, with the type it sorts a top into; the same sleeves the type criteria name. */
const sleeves = {
  short: { criterion: 'Short sleeves, ending above the elbow, as on a t-shirt', type: 'shortSleeveTops' },
  long: { criterion: 'Long sleeves, reaching the forearm or the wrist', type: 'longSleeveTops' },
  none: { criterion: 'No sleeves: a tank top, a camisole or a top with straps', type: 'sleevelessTops' },
} as const satisfies Record<string, { readonly criterion: string; readonly type: PieceType }>
type Sleeve = keyof typeof sleeves

export const sleeveQuestions = {
  sleeve: {
    type: 'choice',
    instructions: 'How long are its sleeves?',
    criteria: Object.fromEntries(Object.entries(sleeves).map(([name, { criterion }]) => [name, criterion])),
  },
}

const Choice = Schema.Struct({ choice: Schema.String, probabilities: Schema.Record(Schema.String, Schema.Number) })
const isSleeve = (choice: string): choice is Sleeve => Object.hasOwn(sleeves, choice)

export interface SleeveRead {
  readonly sleeve: Sleeve | undefined
  readonly probability: number
  /** The type the top moves to: only on a sure answer of long sleeves or none. */
  readonly to: PieceType | undefined
}

/** What Clef said of a short-sleeved top's sleeves, and where that moves it. */
export const sleeveRead = (answer: ClefAnswer): SleeveRead => {
  const chosen = Schema.decodeUnknownOption(Choice)(answer.answers['sleeve'])
  const sleeve = Option.getOrUndefined(
    Option.filter(
      Option.map(chosen, ({ choice }) => choice),
      isSleeve,
    ),
  )
  const probability = Option.match(chosen, {
    onNone: () => 0,
    onSome: ({ choice, probabilities }) => probabilities[choice] ?? 0,
  })
  const to = sleeve !== undefined && sleeve !== 'short' && probability >= sleeveBar ? sleeves[sleeve].type : undefined
  return { sleeve, probability, to }
}
