import { Schema } from 'effect'

/** The design's six moods, for a board and Explore's chips. */
export const Mood = Schema.Literals(['knitwear', 'rain', 'office', 'weekend', 'evening', 'sport'])
export type Mood = typeof Mood.Type

/** At most three moods on a board. */
export const maximumMoods = 3

export const SetMoods = Schema.Struct({ moods: Schema.Array(Mood).check(Schema.isMaxLength(maximumMoods)) })
export type SetMoods = typeof SetMoods.Type
