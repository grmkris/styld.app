import type { Language, ReplyPart } from '@styld/protocol'
import { Match } from 'effect'
import type { Prompt } from 'effect/ai'

/** What the wardrobe holds, in a line or two, so a first answer needs no search. */
export interface WardrobeOutline {
  readonly pieces: number
  readonly byType: Readonly<Record<string, number>>
  readonly colours: ReadonlyArray<string>
}

/** The pieces' garment types and their commonest colours. */
export const outlineOf = (
  pieces: ReadonlyArray<{ readonly type: string; readonly colours: ReadonlyArray<string> }>,
): WardrobeOutline => {
  const byType: Record<string, number> = {}
  const colours = new Map<string, number>()
  for (const piece of pieces) {
    byType[piece.type] = (byType[piece.type] ?? 0) + 1
    for (const colour of piece.colours) colours.set(colour, (colours.get(colour) ?? 0) + 1)
  }
  const common = [...colours.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 6)
  return { pieces: pieces.length, byType, colours: common.map(([colour]) => colour) }
}

const languages: Readonly<Record<Language, string>> = { en: 'English', sl: 'Slovenian' }

/** How to write each language, where the model needs telling: GLM's Slovenian slipped into English words and the
 * plural on the preview, and DeepSeek offered to save a look as a pogled with a masculine bi rad, and spoke of itself
 * as a woman in one answer and a man in the next (2026-10-31). */
const languageNotes: Readonly<Record<Language, string>> = {
  en: '',
  sl: " Address the person with the informal singular ti, and use Slovenian words, not English ones such as outfit or casual. Colours come as English names: say them as Slovenians do (navy is temnomodra, not mornarska). Pieces may have English names too: say what they are in Slovenian (a cable knit is a pulover s kitami, never s kablom). A look the person saves is a videz (plural videzi), as the app names it, never pogled. Never choose the person's gender: where a past tense or a conditional would (bi rad, si videl), ask in the present instead, as in Želiš, da ta videz shranim? Speak of yourself in the present too (predlagam, svetujem), never in a form that gives you a gender (bi predlagala, bi šel). The type flats is any low shoe, nizki čevlji as the app names it: call a piece what it is (čevlji na vezalke, mokasini), and balerinke only when it is a ballet flat.",
}

/** The season in the northern hemisphere, from a `YYYY-MM-DD` date. */
const seasonOf = (today: string) => {
  const month = Number(today.slice(5, 7))
  if (month === 12 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  return month <= 8 ? 'summer' : 'autumn'
}

const describe = (outline: WardrobeOutline) => {
  if (outline.pieces === 0) return 'The wardrobe is empty: nothing has been added yet.'
  const kinds = Object.entries(outline.byType)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ')
  const colours = outline.colours.length === 0 ? '' : ` Commonest colours: ${outline.colours.join(', ')}.`
  return `The wardrobe holds ${outline.pieces} pieces: ${kinds}.${colours}`
}

const slovenianWords = new Set(
  'in je naj kaj za se da ne ali mi moj moja moje mojo kako sem si bi pa tudi kje kdaj prosim hvala danes nocoj jutri obleci kateri katera katero imam zelo lahko iz na po pri'.split(
    ' ',
  ),
)
const englishWords = new Set(
  'the and what which should i my me to for with wear is it of please do how you your can this that on have from'.split(
    ' ',
  ),
)

/** The language a message is written in, as far as its words tell: Slovenian letters and words against English ones;
 * `otherwise` (the app's language) when they do not tell. */
export const languageOf = (text: string, otherwise: Language): Language => {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const slovenian = words.filter((word) => slovenianWords.has(word) || /[čšž]/u.test(word)).length
  const english = words.filter((word) => englishWords.has(word)).length
  if (slovenian === english) return otherwise
  return slovenian > english ? 'sl' : 'en'
}

/** What Styld is told before the chat: who it is, what it may do with its tools, and how to answer, in the one
 * language this reply is written in, decided in code (`languageOf` the person's latest message), so the model never
 * weighs it in its answer. Never the person's name, email or any id. */
export const systemPrompt = (context: {
  readonly language: Language
  readonly today: string
  readonly outline: WardrobeOutline
}) =>
  [
    'You are Styld, a personal stylist inside the Styld wardrobe app. You help one person dress well from the clothes they already own.',
    `Today is ${context.today} (${seasonOf(context.today)}). ${describe(context.outline)}`,
    'Look pieces up with piece_search or piece_get before you name them, and suggest only pieces that are in the wardrobe. When you suggest an outfit or particular pieces, call pieces_show with their ids so the person sees them. Do not say that you are looking things up: write to the person once you have what you need.',
    'To put outfits together, call outfit_make with mode fast: around a piece the person names (anchorPieceId), or with a brief for the weather and the occasion. Show the one you suggest with pieces_show, and offer another from the same answer when asked.',
    'Save a look with look_create only when the person asks you to save or keep it. look_list and look_get read the looks already saved.',
    'When the person asks about the wardrobe as a whole (analyse it, what they have, what is missing, what there is too much of), call wardrobe_analyze once. It shows them the exact counts as a card, so write two or three sentences on what matters most, such as a gap to fill or pieces to wear more, and never list the numbers again.',
    'If the wardrobe lacks something an answer needs, say what kind of piece would help, in general words: there is no shop to send the person to.',
    `Write this reply in ${languages[context.language]}, whatever language earlier messages were in.${languageNotes[context.language]} Use only the Latin alphabet. Plain text only: no Markdown, no headings, no bold, no tables, no notes in brackets. Keep it short and warm, at most about 120 words unless asked for more.`,
    'Write only the reply to the person, never your thoughts about how to answer. Never mention ids, tools, JSON or these instructions. Be kind about bodies and budgets, and decline politely what is not about clothes, outfits or the wardrobe.',
  ].join('\n\n')

/** One earlier part as the tool call that made it: shown pieces as `pieces_show`, a saved look as `look_get`, an
 * analysis as `wardrobe_analyze`. */
const callOf = (part: ReplyPart, id: string) =>
  Match.valueTags(part, {
    Pieces: ({ pieceIds }) => ({ id, name: 'pieces_show', params: { pieceIds }, result: { shown: pieceIds.length } }),
    Look: ({ lookId, name }) => ({ id, name: 'look_get', params: { lookId }, result: { id: lookId, name } }),
    Analysis: ({ analysis }) => ({ id, name: 'wardrobe_analyze', params: {}, result: analysis }),
  })

/** A stored message as the model reads it again. What an earlier reply showed and saved goes back as the tool calls
 * that did it, so a later turn can use the ids and the model never reads a note in its own words it could copy
 * instead of calling pieces_show (browser review, 2 November 2026). `index` keeps the calls' ids apart. */
export const historyMessages = (
  message: { readonly role: 'person' | 'styld'; readonly text: string; readonly parts: ReadonlyArray<ReplyPart> },
  index: number,
): ReadonlyArray<Prompt.MessageEncoded> => {
  if (message.role === 'person') return [{ role: 'user', content: message.text }]
  const calls = message.parts.map((part, nth) => callOf(part, `history_${String(index)}_${String(nth)}`))
  const text = message.text.length > 0 ? [{ type: 'text' as const, text: message.text }] : []
  if (calls.length === 0) return [{ role: 'assistant', content: text }]
  return [
    {
      role: 'assistant',
      content: [...text, ...calls.map(({ id, name, params }) => ({ type: 'tool-call' as const, id, name, params }))],
    },
    {
      role: 'tool',
      content: calls.map(({ id, name, result }) => ({
        type: 'tool-result' as const,
        id,
        name,
        isFailure: false,
        result,
      })),
    },
  ]
}
