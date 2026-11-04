/** The prompt for a clean picture of a garment, drawn from its cut-out.
 *
 * The no-hanger wording and the line on rough outlines come from the 30 October lab: without the hanger Muse copied
 * the cut-out's finger dents and jagged shoulders until told to draw the garment's true outline. The colour and
 * "prefer omission over invention" rules are Styld v1's product-shot rules. Until 4 November it asked for "this exact
 * garment" with its "real fabric", and Muse copied every crease: a tester saw her drawings as the cut-out again ("it
 * only cuts them out"). The owner chose the "pressed" wording from six prompts tried on 23 testers' pieces (12 of
 * them with text or logos, all kept legible; production's comparison passed 22 of 23, as before).
 *
 * The same day (owner, 4 November) a spike redrew the 24 drawings Clef had dropped and found two faults no input
 * fixed. "The sleeves, sides and hem fall straight and symmetrically" erased a garment's own details: lace-up ties,
 * crossed straps and an uneven hem came back plain, and a slouchy bag came back a structured flap bag. Pressing now
 * smooths the fabric only and keeps every detail and the garment's own shape. "Shown whole from the front" turned a
 * hiking boot photographed from the side into a head-on view: shoes and bags (`keepsAngle`) are drawn from the angle
 * their cut-out shows. Redrawn with this wording the boot kept its side view, the bag its slouch and a pair of trainers
 * its three-quarter view, and five plain pieces came back as before. The lace-up knit, the cross-strap top and the
 * printed tee still came back plain: their cut-outs show the garment's back, and asked for the front Muse draws a
 * plain front (`framing`; `docs/STATUS.md`).
 *
 * That evening the tester saw her new pieces "just stretched": "keep the garment's own shape exactly as the reference
 * shows" made Muse trace a crumpled snapshot's outline. A blind search on 55 of her pieces (about 900 drawings, three
 * draws of each of the 20 hardest, two independent judges; `~/code/meta-hackathon/out/styld-prompt-search/`) found
 * Muse varies more between draws than between most wordings, and only one framing pressed every drawing of her
 * bed-sheet snapshots: a gentle ghost mannequin that keeps the garment's own cut (0% still crumpled and 10% bad, against
 * 25% and 25% for the best flat wording, 41% bad for Styld v1's Gemini recipe, and 100% for v1's prompt on Muse). Its
 * cost is details (a crossed back strap drawn plain); the owner chose it with a free redraw whose words correct the
 * drawing (owner, 4 November). Shoes and bags keep their own angle and shape. */

import { slotOf, type PieceType } from '@styld/protocol'

/** The person's words on a redraw, kept short and on one line. */
const tidied = (hint: string) => hint.replaceAll(/\s+/g, ' ').trim().slice(0, 80)

const keyColours = { green: 'green #00ff00', magenta: 'magenta #ff00ff' } as const

/** Whether a piece is drawn from the angle its cut-out shows rather than laid out from the front: shoes, whose side
 * profile is their likeness, and bags, whose shape is their own (owner, 4 November). */
const keepsAngle = (type: PieceType) => slotOf(type) === 'shoes' || type === 'bags'

/** A garment type in the prompt's words: what the photo's garment is called when the cut-out alone was refused, and what a
 * try-on calls each piece it wears. */
export const garmentWords: { readonly [Type in PieceType]: string } = {
  shortSleeveTops: 't-shirt',
  longSleeveTops: 'long-sleeved top',
  sleevelessTops: 'sleeveless top',
  shirts: 'shirt',
  bodysuits: 'bodysuit',
  knitwear: 'knitted top',
  hoodies: 'hoodie',
  blazers: 'blazer',
  jackets: 'jacket',
  coats: 'coat',
  gilets: 'gilet',
  dresses: 'dress',
  jumpsuits: 'jumpsuit',
  jeans: 'jeans',
  trousers: 'trousers',
  shorts: 'shorts',
  skirts: 'skirt',
  sportsBras: 'sports bra',
  sportTops: 'sports top',
  sportBottoms: 'sports leggings or shorts',
  tracksuits: 'tracksuit',
  sportShoes: 'sports shoes',
  outdoorShoes: 'hiking shoes',
  swimwear: 'swimwear',
  // Neutral words, so pyjama trousers or sport leggings are never asked for as a top (4 November).
  loungewear: 'loungewear',
  trainers: 'trainers',
  boots: 'boots',
  heels: 'heels',
  flats: 'flat shoes',
  loafers: 'loafers',
  laceUps: 'lace-up shoes',
  sandals: 'sandals',
  bags: 'bag',
  belts: 'belt',
  scarves: 'scarf',
  hats: 'hat',
  gloves: 'gloves',
  socks: 'socks',
  hairAccessories: 'hair accessory',
  jewellery: 'jewellery',
  eyewear: 'glasses',
}

/** The garment named by its first colours and its type, such as "the grey sleeveless top". */
const named = (type: PieceType, colours: ReadonlyArray<string>) =>
  ['the', ...(colours.length === 0 ? [] : [colours.slice(0, 3).join(' and ')]), garmentWords[type]].join(' ')

/** The second image's line: the side not shown, for reference only. */
const otherSide = {
  front: 'The second image is the back of the same garment, for reference only; show the front.',
  back: 'The second image is the front of the same garment, for its colours and identity only; show the back, as the first image shows it.',
} as const

/** What the drawing is of: the cut-out, or, after Muse refused the cut-out alone, the garment the cut-out marks in the
 * piece's photo, named (owner, 4 November: the spike's variant C drew a bodysuit Muse had refused from its cut-out;
 * asked for "one garment" instead of its name, Muse refused it twice more). */
const subject = (fromPhoto: boolean, garment: string, angle: boolean) => {
  const kind = angle ? 'clean e-commerce product photo' : 'ghost-mannequin e-commerce product photo'
  const end = angle ? ',' : ':'
  return fromPhoto
    ? `The first image is a photo that may show a person or several things; the second image is a rough cut-out of ${garment} from it, showing which garment to draw. Create a ${kind} of ${garment} from the first image${end}`
    : `Create a ${kind} of this garment${end}`
}

/** How the drawing is framed: a shoe or bag as its cut-out shows it; a garment whole from its side on a gentle ghost
 * mannequin. "Laid out evenly" let Muse trace the snapshot; the ghost mannequin is the one framing that pressed every
 * crumpled snapshot in the owner's search, and the cut it must keep stops it narrowing or reshaping the garment. */
const framing = (side: 'front' | 'back', angle: boolean) =>
  angle
    ? 'shown whole from the same angle as the reference shows it (a side view stays a side view), in its own natural shape, centred with clearance on every side.'
    : `shown whole from the ${side}, filled out lightly as if on an invisible form, centred with clearance on every side. Keep the garment’s own cut, width, length and proportions exactly: do not add bust shaping, do not narrow or fit it to a body, do not change a loose or boxy cut, and keep hoods, collars and straps as they are.`

/** How the drawing treats the reference's wear: a shoe or bag cleaned with its shape kept; a garment's snapshot outline
 * named as an accident, never traced, its fabric steamed and its design details kept. */
const pressed = (angle: boolean) =>
  angle
    ? [
        'The item looks clean and cared for. Keep its own shape and every detail exactly as the reference shows them: laces, straps, buckles, panels, soles, flaps and tabs; a soft or slouchy shape stays soft and slouchy.',
        'The reference is a quick snapshot of a worn piece: do not copy its wrinkles, crumpled folds, the rough edges of its cut-out, shadows or lighting.',
      ]
    : [
        'The reference is a quick snapshot of a worn garment dropped on a surface: its outline, bunched or twisted sleeves, skewed sides, crumpled hem, wrinkles, shadows and lighting are accidents of how it lay, not its design. Never trace its silhouette.',
        'The garment is freshly steamed: smooth fabric with no wrinkles or creases, sleeves, sides and hem hanging evenly and symmetrically, unless the garment is asymmetric by design.',
        'Keep every design detail exactly as the reference shows it: ties, laces, crossed or twisted straps, cut-outs, gathers, ruffles, pleats, embroidery, lace trims, and a hem cut uneven or asymmetric by design.',
      ]

/** The owner's words on a redraw: what is wrong with the last drawing, which comes before every other line. */
const correction = (hint: string | undefined) =>
  hint === undefined || tidied(hint) === ''
    ? ''
    : `Its owner says what to correct, and this comes before everything else: ${tidied(hint)}.`

export const cleanPrompt = (input: {
  readonly key: 'green' | 'magenta'
  /** The side the picture shows: a back is drawn only from a real one (owner, 4 November). */
  readonly side: 'front' | 'back'
  /** The piece's type and colours: a shoe or bag keeps its cut-out's angle, and a photo's garment is named by them. */
  readonly type: PieceType
  readonly colours: ReadonlyArray<string>
  /** The piece's photo comes first and the cut-out second, after Muse refused the cut-out alone. */
  readonly fromPhoto: boolean
  readonly hasOther: boolean
  readonly hint: string | undefined
}) =>
  [
    `${subject(input.fromPhoto, named(input.type, input.colours), keepsAngle(input.type))} ${framing(input.side, keepsAngle(input.type))}`,
    'Keep the identity of the item exactly: the same colours (gold stays gold, black stays black), the same pattern, stripe width and spacing, the same cut, length, neckline, collar, buttons, pockets, seams, labels, logos and prints, however small.',
    'Do not add details the reference does not show: no new prints, logos, pockets, hoods, zips or trims.',
    'Parts hidden by hands, folds or the edge of the photo are completed plainly, matching the rest.',
    ...pressed(keepsAngle(input.type)),
    input.hasOther ? otherSide[input.side] : '',
    correction(input.hint),
    `Show no person, hands, body, visible mannequin, hanger, props or text. Soft, even studio light. One completely flat bright ${keyColours[input.key]} background with no gradient, shadow or reflection.`,
  ]
    .filter((line) => line !== '')
    .join(' ')
