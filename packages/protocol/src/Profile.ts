import { Schema } from 'effect'
import { CheckStatus } from './Check.ts'

/** A public handle, `@nika.kovac`: 3–30 lowercase letters, digits, `_` and single inner dots, the Instagram
 * shape (v1's rule), so one can be carried over unchanged. */
export const Handle = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(30),
  Schema.isPattern(/^[a-z0-9_](?:[a-z0-9_]|\.(?!\.))*[a-z0-9_]$/),
).pipe(Schema.brand('Handle'))
export type Handle = typeof Handle.Type

/** Handles that would read as Styld itself, staff or one of its routes (v1's list, with v2's routes). Only an admin
 * gives one out, `styld` to the house account. */
export const reservedHandles: ReadonlySet<string> = new Set([
  'account',
  'admin',
  'api',
  'ask',
  'assistant',
  'boards',
  'cdn',
  'connect',
  'consent',
  'explore',
  'following',
  'help',
  'inspiration',
  'login',
  'looks',
  'mcp',
  'me',
  'oauth',
  'official',
  'out',
  'pieces',
  'privacy',
  'profile',
  'root',
  'rpc',
  'saved',
  'settings',
  'share',
  'staff',
  'styld',
  'stylelab',
  'support',
  'team',
  'terms',
  'wardrobe',
  'wishlist',
])

/** The colour behind a person's initials: the board tints and the prototype's avatar tones. */
export const Tone = Schema.Literals(['sand', 'sage', 'slate', 'clay', 'stone', 'plum', 'olive', 'ink'])
export type Tone = typeof Tone.Type

const Trimmed = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1))
export const ProfileName = Trimmed.check(Schema.isMaxLength(60))
export const City = Trimmed.check(Schema.isMaxLength(60))
export const Bio = Schema.String.check(Schema.isMaxLength(160))

/** The person's own profile. It is public only once published, which needs a handle. */
export const Profile = Schema.Struct({
  handle: Schema.NullOr(Handle),
  name: Schema.String,
  city: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
  tone: Tone,
  published: Schema.Boolean,
  /** The model's check, once published; others see the profile only while the check lets them. */
  check: Schema.NullOr(CheckStatus),
})
export type Profile = typeof Profile.Type

/** Change the profile; fields left out stay, null clears the city or the bio. */
export const UpdateProfile = Schema.Struct({
  handle: Schema.optionalKey(Handle),
  name: Schema.optionalKey(ProfileName),
  city: Schema.optionalKey(Schema.NullOr(City)),
  bio: Schema.optionalKey(Schema.NullOr(Bio)),
  tone: Schema.optionalKey(Tone),
})
export type UpdateProfile = typeof UpdateProfile.Type

export const PublishProfile = Schema.Struct({ published: Schema.Boolean })
export type PublishProfile = typeof PublishProfile.Type

/** Someone else has that handle. */
export class HandleTaken extends Schema.TaggedError<HandleTaken>()('HandleTaken', {}, { httpApiStatus: 409 }) {}

/** A handle only an admin gives out. */
export class HandleReserved extends Schema.TaggedError<HandleReserved>()(
  'HandleReserved',
  {},
  { httpApiStatus: 422 },
) {}

/** Publishing needs a handle first. */
export class ProfileNeedsHandle extends Schema.TaggedError<ProfileNeedsHandle>()(
  'ProfileNeedsHandle',
  {},
  { httpApiStatus: 422 },
) {}
