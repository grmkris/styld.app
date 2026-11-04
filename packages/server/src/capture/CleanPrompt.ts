/** The prompt for a clean picture of a garment, drawn from its cut-out.
 *
 * The no-hanger wording and the line on rough outlines come from the 30 October lab: without the hanger Muse copied
 * the cut-out's finger dents and jagged shoulders until told to draw the garment's true outline. The colour and
 * "prefer omission over invention" rules are Styld v1's product-shot rules. Until 4 November it asked for "this exact
 * garment" with its "real fabric", and Muse copied every crease: a tester saw her drawings as the cut-out again ("it
 * only cuts them out"). The owner chose the "pressed" wording from six prompts tried on 23 testers' pieces (12 of
 * them with text or logos, all kept legible; production's comparison passed 22 of 23, as before). */

/** The person's words on a redraw, kept short and on one line. */
const tidied = (hint: string) => hint.replaceAll(/\s+/g, ' ').trim().slice(0, 80)

const keyColours = { green: 'green #00ff00', magenta: 'magenta #ff00ff' } as const

export const cleanPrompt = (input: {
  readonly key: 'green' | 'magenta'
  readonly hasBack: boolean
  readonly hint: string | undefined
}) =>
  [
    'Create a clean e-commerce product photo of this garment, shown whole from the front, laid out evenly as if on an invisible form, centred with clearance on every side.',
    'Keep the identity of the item exactly: the same colours (gold stays gold, black stays black), the same pattern, stripe width and spacing, the same cut, length, neckline, collar, buttons, pockets, seams, labels, logos and print.',
    'Do not add details the reference does not show: no new prints, logos, pockets, hoods, zips or trims.',
    'Parts hidden by hands, folds or the edge of the photo are completed plainly, matching the rest.',
    'The garment is freshly steamed and pressed: the fabric is smooth with no wrinkles, creases, crumples or folds, and the sleeves, sides and hem fall straight and symmetrically. The reference is a quick snapshot of a worn garment: do not copy its wrinkles, crumpled shape, uneven outline, shadows or lighting.',
    input.hasBack ? 'The second image is the back of the same garment, for reference only; show the front.' : '',
    input.hint === undefined || tidied(input.hint) === '' ? '' : `Its owner describes it as: ${tidied(input.hint)}.`,
    `Show no person, hands, body, mannequin, hanger, props or text. Soft, even studio light. One completely flat bright ${keyColours[input.key]} background with no gradient, shadow or reflection.`,
  ]
    .filter((line) => line !== '')
    .join(' ')
