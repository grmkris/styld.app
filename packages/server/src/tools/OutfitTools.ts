import { MakeOutfit, mostProposals } from '@styld/protocol'
import type { Outfits } from '../outfits/Outfits.ts'
import { tool, toolSpec } from './Tools.ts'

/** Outfits from the person's own pieces, as the assistants and Styld's chat ask for them. */
export const outfitMake = toolSpec({
  name: 'outfit_make',
  title: 'Make outfits',
  description: `Up to ${String(mostProposals)} outfits of pieces in this wardrobe, best first: piece ids in wearing order and a score from a model that looked at them together. \`mode\` fast uses Styld's rules; thinking asks a language model, a limited number of times a day. Optional: \`anchorPieceId\` to build around, \`lockedPieceIds\` to keep, a \`brief\` (season, occasion, words). For more, pass the \`session\` you got and the keys already shown in \`seen\`. \`missing\` names what the wardrobe lacks. Show them with outfits_show; nothing is saved: use look_create.`,
  parameters: MakeOutfit,
  annotations: { readOnlyHint: true, openWorldHint: false },
})

/** Outfits from the person's own pieces: proposals only; a look saves one. */
export const outfitTools = (outfits: Outfits['Service']) => [
  tool({ ...outfitMake, handler: (input) => outfits.make(input) }),
]
