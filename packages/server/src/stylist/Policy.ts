import type { TextTask } from '../ai/LanguageModel.ts'
import { deadlines } from '../providers/Call.ts'
import { textModels } from '../providers/Costs.ts'

// How Styld, the stylist in the app, answers (owner, 2026-10-31).

/** The model Styld answers with, on the paid LiteLLM route: Meta Muse Spark 1.3 (owner, 5 November 2026), each
 * streamed call within the chat deadline. It reasons before it answers, so a call needs at least 1,000 tokens. */
export const styldModel: TextTask = {
  model: textModels.museSpark,
  kind: 'chat',
  deadline: deadlines.chat,
  maxTokens: 2048,
}

/** Model calls a reply may take, each answering the tools the last one called. */
export const maxSteps = 6

/** "Analyze my wardrobe" reads the worn log this many days back (at most `Worn`'s longest range). */
export const analysisDays = 60

/** The most worn pieces an analysis names. */
export const mostWornShown = 3

/** Below this many pieces a wardrobe is still being added, so no area is called too much of. */
export const balancedFrom = 10

/** The fewest of an area a wardrobe that dresses for most days has: fewer is a gap. Dresses and accessories are a
 * choice, never a gap (Eva's review, 2 November 2026; a first rule, tuned with the testers). */
export const fewest = { tops: 5, bottoms: 3, dresses: 0, layers: 2, shoes: 2, accessories: 0 } as const

/** The largest share of the everyday pieces (all but sets) an area takes before it is too much of it. */
export const largestShare = {
  tops: 0.55,
  bottoms: 0.4,
  dresses: 0.35,
  layers: 0.3,
  shoes: 0.3,
  accessories: 0.3,
} as const
