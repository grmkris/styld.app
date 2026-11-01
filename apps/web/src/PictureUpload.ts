import { newOperationId } from './OperationIds.ts'
import { ImageType } from '@styld/protocol'
import { Data, Effect } from 'effect'
import { File } from 'foldkit'
import { StyldClient } from './StyldClient.ts'

/** A picked picture is shrunk to at most this many pixels on its longer side before it is sent. */
const longestSide = 2048

const pictureTypes: ReadonlyArray<string> = ImageType.literals

/** A file that is not a picture Styld takes. */
class NotAPicture extends Data.TaggedError('NotAPicture') {}

/** Shrink a picture to at most 2048px and re-encode it as WebP. Drawing it afresh drops the photo's
 * metadata, its location included. */
const prepared = (file: File.File) =>
  Effect.tryPromise({
    try: async () => {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height))
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      return canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    },
    catch: () => new NotAPicture(),
  })

/** Send one picked picture as an upload of the person's: its id, for whatever claims it next (a board, a piece's
 * back). */
export const uploadPicture = Effect.fn('Styld.Web.uploadPicture')(function* (file: File.File) {
  if (!pictureTypes.includes(File.mimeType(file))) return yield* new NotAPicture()
  const { api: loadApi, sendFile } = yield* StyldClient
  const api = yield* loadApi
  const picture = yield* prepared(file)
  const created = yield* api.wardrobe.createUpload({
    payload: { operationId: yield* newOperationId, contentType: 'image/webp', bytes: picture.size },
  })
  yield* sendFile(created.path, picture)
  return created.uploadId
})
