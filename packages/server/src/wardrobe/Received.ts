import type { ImageType } from '@styld/protocol'
import { Effect } from 'effect'
import type { Wardrobe } from './Wardrobe.ts'

// Picture bytes Styld already holds (a fetched photo, a drawn try-on, a cut-out person) made the person's received
// upload, through the same checks as one they send: what the links, generation and photos modules hand the wardrobe.

/** What an import needs of the wardrobe: making an upload and receiving its bytes. */
export type Uploads = Pick<Wardrobe['Service'], 'newUpload' | 'receiveUpload'>

/** Picture bytes Styld holds as a fresh received upload of the person's, through the same checks as one they send. */
export const receivedUpload = (
  wardrobe: Uploads,
  { contentType, bytes }: { readonly contentType: ImageType; readonly bytes: Uint8Array },
) =>
  Effect.gen(function* () {
    const upload = yield* wardrobe.newUpload({ contentType, bytes: bytes.byteLength })
    // The upload's path carries its one-time token; the origin it is read against does not matter.
    const token = new URL(upload.path, 'https://styld.invalid').searchParams.get('token') ?? ''
    yield* wardrobe.receiveUpload({ uploadId: upload.uploadId, token, contentType, body: bytes })
    return upload.uploadId
  })
