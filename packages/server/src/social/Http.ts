import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Profiles } from './Profiles.ts'

/** The website's profile endpoints, each the matching `Profiles` operation for the session's account; changes are
 * admitted first. */
export const profileHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'profile', (handlers) =>
    Effect.gen(function* () {
      const profiles = yield* Profiles
      return handlers
        .handle('getProfile', () => asSessionAccount(profiles.getProfile()))
        .handle('updateProfile', ({ payload }) => admit(asSessionAccount(profiles.updateProfile(payload))))
        .handle('publishProfile', ({ payload }) => admit(asSessionAccount(profiles.publishProfile(payload))))
    }),
  )
