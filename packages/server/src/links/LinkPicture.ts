import { LinkRefused } from '@styld/protocol'
import { Effect, Option } from 'effect'
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
