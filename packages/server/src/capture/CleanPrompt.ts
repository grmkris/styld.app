/** The prompt for a clean picture of a garment, drawn from its cut-out.
 *
 * The no-hanger wording and the line on rough outlines come from the 30 October lab: without the hanger Muse copied
 * the cut-out's finger dents and jagged shoulders until told to draw the garment's true outline. The colour and
 * "prefer omission over invention" rules are Styld v1's product-shot rules. */

/** The person's words on a redraw, kept short and on one line. */
const tidied = (hint: string) => hint.replaceAll(/\s+/g, ' ').trim().slice(0, 80)

const keyColours = { green: 'green #00ff00', magenta: 'magenta #ff00ff' } as const

export const cleanPrompt = (input: {
  readonly key: 'green' | 'magenta'
  readonly hasBack: boolean
  readonly hint: string | undefined
}) =>
  [
    'Create a clean e-commerce product photo of this exact garment, shown whole from the front, laid out evenly as if on an invisible form, centred with clearance on every side.',
    'Keep every colour exactly as it is in the reference (gold stays gold, black stays black) and keep its real cut, length, fabric, seams, labels, logos and print.',
    'Preserve only what the reference shows and prefer omission over invention: do not add prints, logos, pockets, hoods, zips or other details.',
    'The reference shows the garment as someone held or wore it, so parts may be hidden behind hands, hair or folds, or cut off at the edge: complete those parts plainly, matching the rest.',
    "The reference is a rough cut-out: its outline may have dents, notches or jagged edges where fingers held the garment or the cut was imprecise. Draw the garment's true, smooth outline instead, with natural shoulders, sleeves and hem.",
    input.hasBack ? 'The second image is the back of the same garment, for reference only; show the front.' : '',
    input.hint === undefined || tidied(input.hint) === '' ? '' : `Its owner describes it as: ${tidied(input.hint)}.`,
    `Show no person, hands, body, mannequin, hanger, props or text. Neutral soft studio light. One completely flat bright ${keyColours[input.key]} background with no gradient, shadow or reflection.`,
  ]
    .filter((line) => line !== '')
    .join(' ')
