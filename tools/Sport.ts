import type { PieceType } from '@styld/protocol'
import { Option, Schema } from 'effect'
import type { ClefAnswer } from '../packages/server/src/providers/Clef.ts'

// The question `retype-sport.ts` asks Clef about a stored sport piece, and the type its answer sorts it into. Pure, so
// the rule that moves a person's piece is tested apart from the Cloudflare calls.

/** How sure Clef must be before a stored sport piece moves: a person's piece changes only on a clear answer. */
export const sportBar = 0.7

/** Each kind of sport piece as Clef is asked it, with the type it sorts the piece into; `notSport` is reported, never
 * written, since Clef moved race shirts out of sportswear the wrong way before (T-02, 3 November). */
const kinds = {
  bra: { criterion: 'A sports bra or bra top', type: 'sportsBras' },
  top: { criterion: 'A top for sport: a t-shirt, tank top or long-sleeved top', type: 'sportTops' },
  bottom: { criterion: 'Leggings, cycling shorts, running shorts or joggers', type: 'sportBottoms' },
  tracksuit: { criterion: 'A tracksuit, ski trousers or a ski suit', type: 'tracksuits' },
  notSport: { criterion: 'Not clothing made for sport', type: undefined },
} as const satisfies Record<string, { readonly criterion: string; readonly type: PieceType | undefined }>
type Kind = keyof typeof kinds

export const sportQuestions = {
  kind: {
    type: 'choice',
    instructions: 'Which kind of sportswear is the cut-out piece?',
    criteria: Object.fromEntries(Object.entries(kinds).map(([name, { criterion }]) => [name, criterion])),
  },
}

const Choice = Schema.Struct({ choice: Schema.String, probabilities: Schema.Record(Schema.String, Schema.Number) })
const isKind = (choice: string): choice is Kind => Object.hasOwn(kinds, choice)

export interface SportRead {
  readonly kind: Kind | undefined
  readonly probability: number
  /** The type the piece moves to: only on a sure answer of a sport kind other than a top. */
  readonly to: PieceType | undefined
}

/** What Clef said of a stored sport top, and where that moves it. */
export const sportRead = (answer: ClefAnswer): SportRead => {
  const chosen = Schema.decodeUnknownOption(Choice)(answer.answers['kind'])
  const kind = Option.getOrUndefined(
    Option.filter(
      Option.map(chosen, ({ choice }) => choice),
      isKind,
    ),
  )
  const probability = Option.match(chosen, {
    onNone: () => 0,
    onSome: ({ choice, probabilities }) => probabilities[choice] ?? 0,
  })
  const type = kind === undefined ? undefined : kinds[kind].type
  const to = type !== undefined && type !== 'sportTops' && probability >= sportBar ? type : undefined
  return { kind, probability, to }
}
