import { chromaKey, framed, type KeyColour, pngPicture, readPng, shrink } from '@styld/imaging'
import { Option } from 'effect'
import type { Picture } from '../capture/Providers.ts'

/** How large a sticker is kept, and the room left around what it shows (a share of its longer side). */
const stickerSide = 768
const margin = 0.04

/** A painted sticker with its flat key colour taken out, cropped to what it shows: a transparent PNG. None when the
 * drawing is not a PNG or does not key out cleanly, which counts as a refusal. */
export const stickerOf = (painted: Picture, key: KeyColour): Option.Option<Picture> =>
  Option.map(
    Option.flatMap(readPng(painted.bytes), (drawn) => chromaKey(shrink(drawn, stickerSide), key)),
    (keyed) => pngPicture(framed(keyed, margin)),
  )
