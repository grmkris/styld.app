import { Url } from './Text.ts'
import { byCase, passing, refusal, RequestRefused, SlowDown, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { UploadId, UploadRefused } from './Wardrobe.ts'

// Adding a piece from a shop's product page on the website (Boards, profiles and social, M6). Styld reads the
// page's picture into an upload of the person's; the website then sends it to the review tray like a picked photo.

export const ReadLink = Schema.Struct({ url: Url })
export type ReadLink = typeof ReadLink.Type

/** The page's picture, received as the person's upload, and the name the page gives the product. */
export const LinkPicture = Schema.Struct({ uploadId: UploadId, name: Schema.NullOr(Schema.String) })
export type LinkPicture = typeof LinkPicture.Type

const LinkRefusal = Schema.Literals(['notHttps', 'notReached', 'blocked', 'notAPage', 'noPicture'])

/** Why a link gave nothing to add: then the person sends a photo or a screenshot instead. */
export class LinkRefused extends Schema.TaggedError<LinkRefused>()(
  'LinkRefused',
  { reason: LinkRefusal },
  {
    httpApiStatus: 422,
    guide: byCase<typeof LinkRefusal.Type>('reason', {
      notHttps: refusal('not_https', 'Only public https pages can be read.', 'Give the product page’s https address.'),
      notReached: passing(
        'not_reached',
        'Styld could not reach that page.',
        'Check the address, or ask the person for a photo or screenshot and use piece_add.',
      ),
      blocked: refusal(
        'blocked',
        'The shop does not let Styld read that page.',
        'Ask the person for a photo or screenshot of the piece and use piece_add or upload_create.',
      ),
      notAPage: refusal('not_a_page', 'That address is not a web page.', 'For a picture, use piece_add with imageUrl.'),
      noPicture: refusal(
        'no_picture',
        'That page names no picture of a product.',
        'Ask the person for a photo or screenshot and use piece_add or upload_create.',
      ),
    }),
  },
) {}

export class LinkApi extends HttpApiGroup.make('link')
  .add(
    HttpApiEndpoint.post('readLink', '/links/picture', {
      payload: ReadLink,
      success: LinkPicture,
      error: [LinkRefused, SlowDown, UploadRefused, Unavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession) {}
