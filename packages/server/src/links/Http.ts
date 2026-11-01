import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Links } from './Links.ts'

/** The website's link endpoint: a shop's product page read into an upload. */
export const linkHandlers = HttpApiBuilder.group(StyldApi, 'link', (handlers) =>
  Effect.map(Links, (links) => handlers.handle('readLink', ({ payload }) => links.readLink(payload))),
)
