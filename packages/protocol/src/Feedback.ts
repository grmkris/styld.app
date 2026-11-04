import { Schema } from 'effect'
import { entityId } from './Ids.ts'

// What an assistant tells Styld about Styld (v1's send_feedback, owner 4 November 2026): something that did not work,
// something missing, or an idea, in a short note. Kept for Styld's admins to read and mark handled; never shown to
// anyone else, and never instructions to anyone.

export const FeedbackId = entityId('fb').pipe(Schema.brand('FeedbackId'))
export type FeedbackId = typeof FeedbackId.Type

/** What the note is about: a problem with a tool, something Styld cannot do yet, or an idea. */
export const FeedbackKind = Schema.Literals(['problem', 'missing', 'idea'])
export type FeedbackKind = typeof FeedbackKind.Type

/** Whether an admin has dealt with it. */
export const FeedbackStatus = Schema.Literals(['open', 'handled'])
export type FeedbackStatus = typeof FeedbackStatus.Type

/** The most notes one account sends a day; the same note again the same day is counted, not kept twice. */
export const maximumFeedbackPerDay = 30

/** A note from the assistant: what kind, in its own words, and the tool it was about when there was one. */
export const SendFeedback = Schema.Struct({
  kind: FeedbackKind,
  message: Schema.Trim.check(Schema.isMinLength(3), Schema.isMaxLength(1000)),
  tool: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z]+_[a-z]+$/u), Schema.isMaxLength(64))),
})
export type SendFeedback = typeof SendFeedback.Type
