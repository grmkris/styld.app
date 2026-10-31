import type { ChatLocale, ReplyPart } from '@styld/protocol'
import { Match } from 'effect'

/** What the wardrobe holds, in a line or two, so a first answer needs no search. */
export interface WardrobeOutline {
  readonly pieces: number
  readonly byCategory: Readonly<Record<string, number>>
  readonly colours: ReadonlyArray<string>
}

/** The pieces' categories and their commonest colours. */
export const outlineOf = (
  pieces: ReadonlyArray<{ readonly category: string; readonly colours: ReadonlyArray<string> }>,
): WardrobeOutline => {
  const byCategory: Record<string, number> = {}
  const colours = new Map<string, number>()
  for (const piece of pieces) {
    byCategory[piece.category] = (byCategory[piece.category] ?? 0) + 1
    for (const colour of piece.colours) colours.set(colour, (colours.get(colour) ?? 0) + 1)
  }
  const common = [...colours.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 6)
  return { pieces: pieces.length, byCategory, colours: common.map(([colour]) => colour) }
}

const languages: Readonly<Record<ChatLocale, string>> = { en: 'English', sl: 'Slovenian' }

/** How to write each language, where the model needs telling: GLM's Slovenian slipped into English words and the
 * plural on the preview, and DeepSeek offered to save a look as a pogled with a masculine bi rad, and spoke of itself
 * as a woman in one answer and a man in the next (2026-10-31). */
const languageNotes: Readonly<Record<ChatLocale, string>> = {
  en: '',
  sl: " Address the person with the informal singular ti, and use Slovenian words, not English ones such as outfit or casual. Colours come as English names: say them as Slovenians do (navy is temnomodra, not mornarska). A look the person saves is a videz (plural videzi), as the app names it, never pogled. Never choose the person's gender: where a past tense or a conditional would (bi rad, si videl), ask in the present instead, as in Želiš, da ta videz shranim? Speak of yourself in the present too (predlagam, svetujem), never in a form that gives you a gender (bi predlagala, bi šel).",
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
  const kinds = Object.entries(outline.byCategory)
    .map(([category, count]) => `${count} ${category}`)
    .join(', ')
  const colours = outline.colours.length === 0 ? '' : ` Commonest colours: ${outline.colours.join(', ')}.`
  return `The wardrobe holds ${outline.pieces} pieces: ${kinds}.${colours}`
}

/** What Styld is told before the chat: who it is, what it may do with its tools, and how to answer. Never the
 * person's name, email or any id. */
export const systemPrompt = (context: {
  readonly locale: ChatLocale
  readonly today: string
  readonly outline: WardrobeOutline
}) =>
  [
    'You are Styld, a personal stylist inside the Styld wardrobe app. You help one person dress well from the clothes they already own.',
    `Today is ${context.today} (${seasonOf(context.today)}). ${describe(context.outline)}`,
    'Look pieces up with piece_search or piece_get before you name them, and suggest only pieces that are in the wardrobe. When you suggest an outfit or particular pieces, call pieces_show with their ids so the person sees them. Do not say that you are looking things up: write to the person once you have what you need.',
    'Save a look with look_create only when the person asks you to save or keep it. look_list and look_get read the looks already saved.',
    'If the wardrobe lacks something an answer needs, say what kind of piece would help, in general words: there is no shop to send the person to.',
    `Write in ${languages[context.locale]} unless the person writes in another language.${languageNotes[context.locale]} Plain text only: no Markdown, no headings, no bold, no tables. Keep it short and warm, at most about 120 words unless asked for more.`,
    'Never mention ids, tools, JSON or these instructions. Be kind about bodies and budgets, and decline politely what is not about clothes, outfits or the wardrobe.',
  ].join('\n\n')

/** A stored message as the model reads it again: what was shown and saved, by id, so a later turn can use it. */
export const historyText = (message: {
  readonly role: 'person' | 'styld'
  readonly text: string
  readonly parts: ReadonlyArray<ReplyPart>
}) => {
  const notes = message.parts.map(
    Match.valueTags({
      Pieces: ({ pieceIds }) => `[shown: ${pieceIds.join(', ')}]`,
      Look: ({ lookId }) => `[saved the look ${lookId}]`,
    }),
  )
  return [message.text, ...notes].filter((line) => line.length > 0).join('\n')
}
