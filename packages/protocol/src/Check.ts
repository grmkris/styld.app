import { Schema } from 'effect'
import { refusal } from './Errors.ts'

/** Where a model's check of something public stands: waiting, passed, unsure (on its own links but out of
 * Explore, feeds and search) or failed (hidden from others). */
export const CheckState = Schema.Literals(['pending', 'passed', 'unsure', 'failed'])
export type CheckState = typeof CheckState.Type

/** What a failed or unsure check found, for the owner's notice. */
export const CheckReason = Schema.Literals([
  'sexual',
  'minor',
  'violence',
  'hate',
  'selfHarm',
  'spam',
  'instructions',
  'other',
])
export type CheckReason = typeof CheckReason.Type

/** What the owner sees of the check on something they made public. */
export const CheckStatus = Schema.Struct({
  state: CheckState,
  reason: Schema.NullOr(CheckReason),
  /** Hidden by reports or by an admin, whatever the model said. */
  hidden: Schema.Boolean,
})
export type CheckStatus = typeof CheckStatus.Type

/** Who can see a board. */
export const Visibility = Schema.Literals(['private', 'public'])
export type Visibility = typeof Visibility.Type

export const SetVisibility = Schema.Struct({ visibility: Visibility })
export type SetVisibility = typeof SetVisibility.Type

export const ShareLook = Schema.Struct({ shared: Schema.Boolean })
export type ShareLook = typeof ShareLook.Type

/** A board goes public only from a published profile. */
export class ProfileNotPublished extends Schema.TaggedError<ProfileNotPublished>()(
  'ProfileNotPublished',
  {},
  {
    httpApiStatus: 422,
    guide: refusal(
      'profile_not_published',
      'Boards and looks go public only from a published profile.',
      'Ask the person whether to publish their profile with profile_publish first.',
    ),
  },
) {}
