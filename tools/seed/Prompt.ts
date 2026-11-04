import { createHash } from 'node:crypto'
import type { Colour, PieceType } from '@styld/protocol'
import type { Spec } from './Manifest.ts'

// The words each house garment is generated from (owner, 4 November 2026): one garment alone as a clean catalogue
// product photo, in the house style of the clean pictures (`capture/CleanPrompt.ts`: no hanger, nobody, and leave a
// detail out rather than invent it). Pure: the same spec always gives the same prompt, so its digest is the cache key
// and the provenance row's `prompt_digest`.

export const museModel = 'muse-image-1.0'

/** The two sizes the seed asks Muse for: tall for long garments, square for the rest. */
export type MuseSize = '1024x1024' | '1024x1536'

const tall: ReadonlySet<PieceType> = new Set([
  'coats',
  'dresses',
  'jumpsuits',
  'trousers',
  'jeans',
  'skirts',
  'scarves',
  'sportswear',
])

export const sizeOf = (type: PieceType): MuseSize => (tall.has(type) ? '1024x1536' : '1024x1024')

const flat = 'laid flat, seen from directly above'
const onForm = 'front view on an invisible ghost mannequin (no mannequin visible)'
const pair = 'the pair side by side, three-quarter view from the outer side'
const threeQuarter = 'front three-quarter view'

/** How each kind of garment is shown: tops and bottoms flat, tailoring and dresses on an invisible form, shoes as a
 * pair, a bag upright, a hat or glasses at three-quarters. */
const views: Readonly<Record<PieceType, string>> = {
  shortSleeveTops: flat,
  longSleeveTops: flat,
  sleevelessTops: flat,
  shirts: flat,
  bodysuits: onForm,
  knitwear: flat,
  hoodies: flat,
  blazers: onForm,
  jackets: onForm,
  coats: onForm,
  gilets: onForm,
  dresses: onForm,
  jumpsuits: onForm,
  jeans: flat,
  trousers: flat,
  shorts: flat,
  skirts: flat,
  sportswear: flat,
  sportShoes: pair,
  outdoorShoes: pair,
  swimwear: onForm,
  loungewear: flat,
  trainers: pair,
  boots: pair,
  heels: pair,
  flats: pair,
  loafers: pair,
  laceUps: pair,
  sandals: pair,
  bags: 'front view, standing upright',
  belts: `${flat}, loosely coiled`,
  scarves: `${flat}, folded once`,
  hats: threeQuarter,
  gloves: flat,
  socks: flat,
  hairAccessories: flat,
  jewellery: flat,
  eyewear: threeQuarter,
}

/** A pale garment gets a mid grey ground so background removal has an edge to find; the rest a light warm grey. Grey
 * itself stays on the light ground: on mid grey it would have no edge either. */
const pale: ReadonlySet<Colour> = new Set(['white', 'beige', 'yellow'])

const groundOf = (colour: Colour | undefined) =>
  colour !== undefined && pale.has(colour) ? 'mid grey (#9A9A9A)' : 'light warm grey (#ECEAE6)'

/** The spec's prompt, as the brief's template words it. */
export const promptOf = (spec: Spec) =>
  [
    `One ${spec.subcategory}, ${spec.material}, ${spec.look}, alone, as a clean catalogue product photo.`,
    `View: ${views[spec.type]}. The whole piece is in frame, centred, with clear space on every side.`,
    `Background: plain, flat, seamless ${groundOf(spec.colours[0])}, with only a soft contact shadow. No props, no surface texture.`,
    'Light: soft, even studio light from the front; true-to-life colour; the same light and camera height for every piece.',
    'Never: a person, body parts, a mannequin, a hanger or hook, tags, labels, logos, brand names, text or a watermark.',
    'Photorealistic. If a detail is unclear, leave it out rather than invent it.',
  ].join('\n')

/** The prompt of a later attempt: the spec's own, and what the last one got wrong. */
export const retryPromptOf = (spec: Spec, failure: string | undefined) =>
  failure === undefined ? promptOf(spec) : `${promptOf(spec)}\n${failure}`

/** What a generated picture is keyed by: the model, the size and the spec's own prompt. */
export const promptDigestOf = (spec: Spec) =>
  createHash('sha256')
    .update(`${museModel}\n${sizeOf(spec.type)}\n${promptOf(spec)}`)
    .digest('hex')
