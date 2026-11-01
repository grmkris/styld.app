import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Profiles } from './Profiles.ts'

/** The website's profile endpoints, each the matching `Profiles` operation for the session's account; changes are
 * admitted first. */
export const profileHandlers = HttpApiBuilder.group(StyldApi, 'profile', (handlers) =>
  Effect.gen(function* () {
    const profiles = yield* Profiles
    return handlers
      .handle('getProfile', () => profiles.getProfile())
      .handle('updateProfile', ({ payload }) => profiles.updateProfile(payload))
      .handle('publishProfile', ({ payload }) => profiles.publishProfile(payload))
  }),
)
