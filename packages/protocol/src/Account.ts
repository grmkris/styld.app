import { Schema } from 'effect'

/** The signed-in person as the website and assistants see them. */
export const Me = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  email: Schema.String,
})
export type Me = typeof Me.Type
