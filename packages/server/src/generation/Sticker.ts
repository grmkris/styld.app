import { chromaKey, decodePng, encodePng, framed, type KeyColour, shrink } from '@styld/imaging'
import { Option } from 'effect'
import type { Picture } from '../capture/Providers.ts'

/** How large a sticker is kept, and the room left around what it shows (a share of its longer side). */
const stickerSide = 768
const margin = 0.04

/** A painted sticker with its flat key colour taken out, cropped to what it shows: a transparent PNG. None when the
 * drawing is not a PNG or does not key out cleanly, which counts as a refusal. */
export const stickerOf = (painted: Picture, key: KeyColour): Option.Option<Picture> => {
  try {
    return Option.map(chromaKey(shrink(decodePng(painted.bytes), stickerSide), key), (keyed) => ({
      bytes: encodePng(framed(keyed, margin)),
      contentType: 'image/png',
    }))
  } catch {
    return Option.none()
  }
}
