import type { ImageType } from '@styld/protocol'
import { Option, Schema } from 'effect'

/** Every object of an account sits under one prefix, so deleting an account is one sweep. */
export const accountPrefix = (accountId: string) => `accounts/${accountId}/`

/** Where a piece's own files live beside its photo: its clean drawings. */
export const piecePrefix = (accountId: string, pieceId: string) => `${accountPrefix(accountId)}pieces/${pieceId}/`

export const uploadKey = (accountId: string, uploadId: string) => `${accountPrefix(accountId)}uploads/${uploadId}`

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const ascii = (text: string) => Array.from(new TextEncoder().encode(text))

/** The image type the bytes really are, from their signature; the declared type is not trusted. */
export const sniffImageType = (bytes: Uint8Array): Option.Option<ImageType> => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return Option.some('image/jpeg')
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return Option.some('image/png')
  if (startsWith(bytes, ascii('GIF8'))) return Option.some('image/gif')
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return Option.some('image/webp')
  if (
    startsWith(bytes, ascii('ftyp'), 4) &&
    (startsWith(bytes, ascii('avif'), 8) || startsWith(bytes, ascii('avis'), 8))
  )
    return Option.some('image/avif')
  return Option.none()
}

/** Whether the bytes start an ISO base media file (MP4, or QuickTime MOV): a `ftyp` box first. */
export const isVideoContainer = (head: Uint8Array) =>
  startsWith(head, ascii('ftyp'), 4) && !startsWith(head, ascii('avif'), 8) && !startsWith(head, ascii('avis'), 8)

/** The sizes the website shows: a grid thumbnail and the piece's own page. */
export const imageSizes = { thumb: 480, full: 1600 } as const
export type ImageSize = keyof typeof imageSizes

/** The sizes an image route serves (`imageSizes`). */
export const ShownSize = Schema.Literals(['thumb', 'full'])
export type ShownSize = typeof ShownSize.Type
