import { PieceId, type ReplyPart } from '@styld/protocol'
import { Predicate } from 'effect'
import { showLimit } from './Tools.ts'

// What a reply may show the person (browser review, 2 November 2026): DeepSeek wrote a note to itself about which
// language to answer in, copied the `[shown: pc_…]` notes earlier history used to carry as words instead of calling
// pieces_show, and slipped a Chinese word into English. The prompt and the history no longer invite any of these
// (`Prompt.ts`); this is the last line, applied to every reply and to what is shown while it is written.

/** A note naming pieces in square brackets, `[shown: pc_…, pc_…]` or any other wording: the ids are kept. */
const pieceNote = /\[[^\]\n]*?\bpc_[\w-]+[^\]\n]*\]/gu
/** A note about a saved look, `[saved the look lk_…]`, which shows nothing by itself. */
const lookNote = /\[[^\]\n]*?\blk_[\w-]+[^\]\n]*\]/gu
/** A note still being written at the end of a reply: hidden until it closes. */
const openNote = /\[[^\]\n]*$/u
const pieceId = /\bpc_[\w-]+/gu
/** Han, kana and Hangul: never part of an English or a Slovenian reply. */
const otherScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
/** A paragraph about "the user" is the model talking to itself: Styld speaks to the person as you (ti). */
const aboutTheUser = /\b(?:the\s+)?user\b(?!-)|\buporabni(?:k|ca|ku|ka|ce)\b/iu

const tidy = (text: string) =>
  text
    .split(/\n{2,}/u)
    .map((paragraph) =>
      paragraph
        .replace(/[ \t]{2,}/gu, ' ')
        .replace(/[ \t]+$/gmu, '')
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0 && !aboutTheUser.test(paragraph))
    .join('\n\n')

/** A reply's words as the person reads them: notes and ids gone, a paragraph addressed to the model's self dropped,
 * other scripts removed. */
export const readableReply = (text: string) =>
  tidy(
    text
      .replace(pieceNote, '')
      .replace(lookNote, '')
      .replace(openNote, '')
      .replace(pieceId, '')
      .replace(otherScript, ''),
  )

/** The pieces a reply names in its notes, only those in the person's wardrobe, each once, in order. */
const notedPieces = (text: string, own: ReadonlySet<string>) => {
  const named = [...text.matchAll(pieceNote)].flatMap(([note]) => [...note.matchAll(pieceId)].map(([id]) => id))
  return [...new Set(named)].filter((id) => own.has(id))
}

/** A finished reply: its readable words, and its parts with the person's own pieces it only named in a note shown as
 * pieces_show would have shown them (at most `showLimit`); a note naming no piece of theirs shows nothing. */
export const finishedReply = (
  written: string,
  parts: ReadonlyArray<ReplyPart>,
  own: ReadonlySet<string>,
): { readonly text: string; readonly parts: ReadonlyArray<ReplyPart> } => {
  const shown = new Set<string>(parts.flatMap((part) => (Predicate.isTagged(part, 'Pieces') ? part.pieceIds : [])))
  const noted = notedPieces(written, own)
    .filter((id) => !shown.has(id))
    .slice(0, showLimit)
  const text = readableReply(written)
  if (noted.length === 0) return { text, parts }
  return { text, parts: [...parts, { _tag: 'Pieces', pieceIds: noted.map((id) => PieceId.make(id)) }] }
}
