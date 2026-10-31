import type { Profile } from '@styld/protocol'
import { Effect } from 'effect'
import { StyldClient } from '../StyldClient.ts'

/** The person's own profile as Styld has it, as a page's Message: for the profile's editor and for the account,
 * which says where it stands. */
export const readProfile = <Read, Missed>(read: (profile: Profile) => Read, missed: () => Missed) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return read(yield* api.profile.getProfile())
  }).pipe(Effect.orElseSucceed(missed))
