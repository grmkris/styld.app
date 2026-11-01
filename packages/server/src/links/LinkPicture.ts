import { LinkPicture, LinkRefused, type ReadLink, Unavailable } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { importedUpload, type Uploads } from '../mcp/ImageImport.ts'
import { readProductPage } from './LinkImport.ts'

/** A product page's picture as a received upload of the person's, with the page's name for the product: what the
 * website sends to the review tray. A picture the page names but Styld cannot take counts as no picture. */
export const pictureFromLink = Effect.fn('Styld.Links.pictureFromLink')(function* (wardrobe: Uploads, url: string) {
  const page = yield* readProductPage(url)
  const uploadId = yield* importedUpload(wardrobe, page.image).pipe(
    Effect.catchTag('ImportRefused', ({ reason }) =>
      Effect.fail(LinkRefused.make({ reason: reason === 'notReached' ? 'notReached' : 'noPicture' })),
    ),
  )
  return { uploadId, name: Option.getOrNull(page.title) }
})

const LinkPictureJson = Schema.fromJsonString(LinkPicture)

/** The links operation the website and the assistants share: a shop's page read into an upload, answered once per
 * operation id, so a repeat neither reads the page again nor makes a second upload. */
export const readLink = Effect.fn('Styld.Links.readLink')(function* (wardrobe: Wardrobe['Service'], input: ReadLink) {
  return yield* wardrobe.once(
    { operationId: input.operationId, command: 'readLink', input: input.url },
    {
      replay: (result) =>
        Schema.decodeUnknownEffect(LinkPictureJson)(result).pipe(Effect.mapError(() => Unavailable.make({}))),
      run: Effect.flatMap(pictureFromLink(wardrobe, input.url), (picture) =>
        Effect.map(
          Schema.encodeEffect(LinkPictureJson)(picture).pipe(Effect.mapError(() => Unavailable.make({}))),
          (result) => [picture, result] as const,
        ),
      ),
    },
  )
})
