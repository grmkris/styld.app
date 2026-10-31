import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Social } from './Social.ts'

/** The website's social endpoints, each the matching `Social` operation for the session's account; changes are
 * admitted first. */
export const socialHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'social', (handlers) =>
    Effect.gen(function* () {
      const social = yield* Social
      return handlers
        .handle('listSaved', () => asSessionAccount(social.listSaved()))
        .handle('setSaved', ({ payload }) => admit(asSessionAccount(social.setSaved(payload))))
        .handle('relation', ({ params }) => asSessionAccount(social.relation(params.handle)))
        .handle('setFollowing', ({ params, payload }) =>
          admit(asSessionAccount(social.setFollowing(params.handle, payload))),
        )
        .handle('setBlocked', ({ params, payload }) =>
          admit(asSessionAccount(social.setBlocked(params.handle, payload))),
        )
        .handle('following', () => asSessionAccount(social.following()))
        .handle('blocked', () => asSessionAccount(social.blocked()))
        .handle('report', ({ payload }) => admit(asSessionAccount(social.report(payload))))
        .handle('feed', ({ query }) => asSessionAccount(social.feed(query.cursor)))
        .handle('listWishes', () => asSessionAccount(social.listWishes()))
        .handle('addWish', ({ payload }) => admit(asSessionAccount(social.addWish(payload))))
        .handle('removeWish', ({ params }) => admit(asSessionAccount(social.removeWish(params.wishId))))
    }),
  )
