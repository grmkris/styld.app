import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Audience } from './BoardTags.ts'
import { OperationConflict, Unavailable } from './Errors.ts'
import { OperationId } from './Ids.ts'
import { SessionAccount } from './Session.ts'

// What the person asked to be shown first (owner, 4 November 2026): Women's, Men's or Everything, asked after they
// sign in, never at sign-up. It only reorders What's new; nothing is ever hidden. Private: never on the public
// profile, and never guessed.

/** The person's reading preferences: what they asked to see first (none is Everything), and whether Home's card asked
 * them already (answered or put away). */
export const Preferences = Schema.Struct({ showMe: Schema.NullOr(Audience), showMeAsked: Schema.Boolean })
export type Preferences = typeof Preferences.Type

/** Answer Show me, or put the card away with none: `PUT /api/me/preferences/show-me`. */
export const SetShowMe = Schema.Struct({ operationId: OperationId, showMe: Schema.NullOr(Audience) })
export type SetShowMe = typeof SetShowMe.Type

/** The person's preferences. */
export class PreferencesApi extends HttpApiGroup.make('preferences')
  .add(HttpApiEndpoint.get('getPreferences', '/me/preferences', { success: Preferences, error: Unavailable }))
  .add(
    HttpApiEndpoint.put('setShowMe', '/me/preferences/show-me', {
      payload: SetShowMe,
      success: Preferences,
      error: [OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
