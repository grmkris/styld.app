import { ImageType, UploadId } from '@styld/protocol'
import { Context, Data, Effect, Layer, Option, Schema } from 'effect'
import { File } from 'foldkit'
import { newOperationId } from './OperationIds.ts'
import { StyldClient } from './StyldClient.ts'

// Every picture the person sends (a photo to add pieces from, a gallery photo, a piece's back, a board's picture) goes
// up one way: drawn afresh, shrunk and re-encoded on the device first, so its metadata, location included, never
// leaves it.

/** A file that is not a picture Styld takes, or one the browser could not draw. */
export class NotAPicture extends Data.TaggedError('NotAPicture') {}

/** Draws a picked picture afresh as the bytes that are sent. */
export class PictureEncoder extends Context.Service<
  PictureEncoder,
  { readonly encode: (file: Blob) => Effect.Effect<Blob, NotAPicture> }
>()('@styld/web/PictureEncoder') {}

/** A picture is shrunk to at most this many pixels on its longer side before it is sent. */
const longestSide = 2048

/** The browser's encoder: the picture drawn on a canvas at most 2048px across and saved as WebP. Drawing it afresh
 * keeps only its pixels. */
export const pictureEncoderLayer = Layer.succeed(PictureEncoder, {
  encode: (file) =>
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
    }),
})

const pictureTypes: ReadonlyArray<string> = ImageType.literals

/** Send one picked picture as an upload of the person's: its id, for whatever claims it next (a capture, a gallery
 * photo, a board, a piece's back). */
export const uploadPicture = Effect.fn('Styld.Web.uploadPicture')(function* (file: File.File) {
  if (!pictureTypes.includes(File.mimeType(file))) return yield* new NotAPicture()
  const picture = yield* (yield* PictureEncoder).encode(file)
  const { api: loadApi, sendFile } = yield* StyldClient
  const created = yield* (yield* loadApi).wardrobe.createUpload({
    payload: { operationId: yield* newOperationId, contentType: 'image/webp', bytes: picture.size },
  })
  yield* sendFile(created.path, picture)
  return created.uploadId
})

/** A picture's upload: the one an earlier try already made, or a new one. */
export const uploadPictureOnce = (file: File.File, known: Option.Option<string>) =>
  Option.match(known, {
    onSome: (id) => Schema.decodeUnknownEffect(UploadId)(id),
    onNone: () => uploadPicture(file),
  })
