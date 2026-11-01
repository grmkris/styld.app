import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Social } from './Social.ts'

/** The website's social endpoints, each the matching `Social` operation for the session's account; changes are
 * admitted first. */
export const socialHandlers = HttpApiBuilder.group(StyldApi, 'social', (handlers) =>
  Effect.gen(function* () {
    const social = yield* Social
    return handlers
      .handle('listSaved', () => social.listSaved())
      .handle('setSaved', ({ payload }) => social.setSaved(payload))
      .handle('relation', ({ params }) => social.relation(params.handle))
      .handle('setFollowing', ({ params, payload }) => social.setFollowing(params.handle, payload))
      .handle('setBlocked', ({ params, payload }) => social.setBlocked(params.handle, payload))
      .handle('following', () => social.following())
      .handle('blocked', () => social.blocked())
      .handle('report', ({ payload }) => social.report(payload))
      .handle('feed', ({ query }) => social.feed(query.cursor))
  }),
)
