import { Option, Predicate, Schema } from 'effect'

// Why a piece's redraw or turn was not made, as the page tells its owner, from the API's refusals.

/** Why a turn was not made: the API's refusals, the day's credits, no answer, or a device that could not cut the
 * turn's video into frames. */
export const TurnProblem = Schema.Literals(['busy', 'picture', 'dailyLimit', 'network', 'build'])
export type TurnProblem = typeof TurnProblem.Type

/** Why a redraw was not asked for: the API's refusals, the day's credits, or no answer. */
export const RedrawProblem = Schema.Literals(['busy', 'face', 'photo', 'dailyLimit', 'network'])
export type RedrawProblem = typeof RedrawProblem.Type

/** What a refused redraw means for the owner. */
export const redrawProblemOf = (error: unknown): RedrawProblem => {
  if (Predicate.isTagged(error, 'LimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'PictureRefused') && Predicate.hasProperty(error, 'reason'))
    return Schema.decodeUnknownOption(RedrawProblem)(error.reason).pipe(Option.getOrElse(() => 'network' as const))
  return 'network'
}

/** What a refused turn means for the owner. */
export const turnProblemOf = (error: unknown): TurnProblem => {
  if (Predicate.isTagged(error, 'LimitReached')) return 'dailyLimit'
  if (Predicate.isTagged(error, 'TurnRefused') && Predicate.hasProperty(error, 'reason'))
    return Schema.decodeUnknownOption(TurnProblem)(error.reason).pipe(Option.getOrElse(() => 'network' as const))
  return 'network'
}
