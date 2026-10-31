import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { RequestRefused } from './Account.ts'
import { UploadId, UploadRefused, WardrobeUnavailable } from './Wardrobe.ts'

// Adding a piece from a shop's product page on the website (Boards, profiles and social, M6). Styld reads the
// page's picture into an upload of the person's; the website then sends it to the review tray like a picked photo.

export const ReadLink = Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(2048)) })
export type ReadLink = typeof ReadLink.Type

/** The page's picture, received as the person's upload, and the name the page gives the product. */
export const LinkPicture = Schema.Struct({ uploadId: UploadId, name: Schema.NullOr(Schema.String) })
export type LinkPicture = typeof LinkPicture.Type

/** Why a link gave nothing to add: then the person sends a photo or a screenshot instead. */
export class LinkRefused extends Schema.TaggedError<LinkRefused>()(
  'LinkRefused',
  { reason: Schema.Literals(['notHttps', 'notReached', 'blocked', 'notAPage', 'noPicture']) },
  { httpApiStatus: 422 },
) {}

/** Too many links read in a minute. */
export class LinkSlowDown extends Schema.TaggedError<LinkSlowDown>()('LinkSlowDown', {}, { httpApiStatus: 429 }) {}

export class LinkApi extends HttpApiGroup.make('links')
  .add(
    HttpApiEndpoint.post('readLink', '/links/picture', {
      payload: ReadLink,
      success: LinkPicture,
      error: [LinkRefused, LinkSlowDown, UploadRefused, WardrobeUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}
