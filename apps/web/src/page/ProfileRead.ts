import { Profile } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { StyldClient } from '../StyldClient.ts'

/** The person's own profile as Styld has it, as a page's Message: for the profile's editor and for the account,
 * which says where it stands. */
export const readProfile = <Read, Missed>(read: (profile: Profile) => Read, missed: () => Missed) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return read(yield* api.profile.getProfile())
  }).pipe(Effect.orElseSucceed(missed))

/** The person's profile as last read, for the editor and the account; a failed read keeps the one shown. */
export const ProfileData = AsyncData.Schema(Profile, Schema.Literal('Unavailable'))
export type ProfileData = typeof ProfileData.schema.Type
