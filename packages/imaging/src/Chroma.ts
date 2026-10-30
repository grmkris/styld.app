import { Option } from 'effect'
import { onBorder, type Rgba } from './Raster.ts'

/** The flat colour an image model draws behind a garment, to be keyed out: green, or magenta for a green garment. */
export type KeyColour = 'green' | 'magenta'

/** How strongly the key colour dominates a pixel, 0 to 1: green over red and blue, or red and blue over green. */
const dominance = (data: Uint8Array, at: number, key: KeyColour) => {
  const red = (data[at] ?? 0) / 255
  const green = (data[at + 1] ?? 0) / 255
  const blue = (data[at + 2] ?? 0) / 255
  return Math.max(0, key === 'green' ? green - Math.max(red, blue) : Math.min(red, blue) - green)
}

/** How bright the key's own channels are, 0 to 1. */
const brightness = (data: Uint8Array, at: number, key: KeyColour) =>
  key === 'green' ? (data[at + 1] ?? 0) / 255 : Math.min(data[at] ?? 0, data[at + 2] ?? 0) / 255

// A pixel whose key dominance is below `solid` is garment, above `clear` background, and between, a mix at the edge.
// Measured on Muse and Veo pictures, 30 October: distance from the key colour reads a half-and-half mix of a dark
// garment and the key as nearly opaque, so dominance is used instead.
const solid = 0.035
const clear = 0.58
// Only pixels in or beside bright key areas may turn transparent, so a dark green print inside a garment stays.
const keyArea = { dominance: 0.2, brightness: 0.42, reach: 2 }
// Styld v1's checks that a key worked (stylelab `packages/wardrobe/src/chroma-key.ts`): the border is mostly key
// colour, something was removed and the garment remains.
const borderKeyShare = 0.55
const clearShare = 0.08
const opaqueShare = 0.08

/** The key colour to draw a garment on: the one its own pixels lean towards less, green when tied (v1's rule, read
 * from the cut-out's pixels instead of a colour name). */
export const keyColourFor = (cutout: Rgba): KeyColour => {
  const lean = { green: 0, magenta: 0 }
  for (let at = 0; at < cutout.data.length; at += 4) {
    if ((cutout.data[at + 3] ?? 0) < 200) continue
    if (dominance(cutout.data, at, 'green') > 0.1) lean.green += 1
    if (dominance(cutout.data, at, 'magenta') > 0.1) lean.magenta += 1
  }
  return lean.magenta < lean.green ? 'magenta' : 'green'
}

/** Whether any pixel within `reach` of position `at`, stepping by `step` along a line of `length`, is marked. */
const markedNear = (marked: Uint8Array, at: number, index: number, length: number, step: number, reach: number) => {
  for (let offset = Math.max(-reach, -index); offset <= Math.min(reach, length - 1 - index); offset++)
    if (marked[at + offset * step] === 1) return true
  return false
}

/** Pixels within `reach` of a marked one, marked too (a square neighbourhood, row pass then column pass). */
const widened = (marked: Uint8Array, width: number, height: number, reach: number) => {
  const rows = new Uint8Array(marked.length)
  for (let at = 0; at < marked.length; at++) rows[at] = markedNear(marked, at, at % width, width, 1, reach) ? 1 : 0
  const out = new Uint8Array(marked.length)
  for (let at = 0; at < marked.length; at++)
    out[at] = markedNear(rows, at, Math.floor(at / width), height, width, reach) ? 1 : 0
  return out
}

/** The middle value of a list of numbers. */
const median = (values: Array<number>) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

/** The background's actual colour: the median of the border pixels, per channel. Models draw near the key, not on it. */
const borderColour = (picture: Rgba): readonly [number, number, number] => {
  const red: Array<number> = []
  const green: Array<number> = []
  const blue: Array<number> = []
  const add = (x: number, y: number) => {
    const at = (y * picture.width + x) * 4
    red.push(picture.data[at] ?? 0)
    green.push(picture.data[at + 1] ?? 0)
    blue.push(picture.data[at + 2] ?? 0)
  }
  for (let x = 0; x < picture.width; x++) {
    add(x, 0)
    add(x, picture.height - 1)
  }
  for (let y = 0; y < picture.height; y++) {
    add(0, y)
    add(picture.width - 1, y)
  }
  return [median(red), median(green), median(blue)]
}

/** The pixels where the key colour dominates and is bright: background, as opposed to a dark green print. */
const keyPixelsOf = (picture: Rgba, key: KeyColour) => {
  const marked = new Uint8Array(picture.width * picture.height)
  for (let at = 0; at < marked.length; at++) {
    const keyLike = dominance(picture.data, at * 4, key) > keyArea.dominance
    marked[at] = keyLike && brightness(picture.data, at * 4, key) > keyArea.brightness ? 1 : 0
  }
  return marked
}

/** A pixel's opacity: garment where the key does not dominate, background where it does, a mix between; only pixels
 * in or beside a key area may lose any. */
const opacityOf = (data: Uint8Array, at: number, key: KeyColour, nearKey: boolean) => {
  if (!nearKey) return 1
  const share = (dominance(data, at * 4, key) - solid) / (clear - solid)
  return Math.min(1, Math.max(0, 1 - share))
}

/** The observed colour is alpha·garment + (1 − alpha)·background: take the background back out. */
const unmix = (data: Uint8Array, at: number, alpha: number, backing: readonly [number, number, number]) => {
  for (let channel = 0; channel < 3; channel++) {
    const unmixed = ((data[at * 4 + channel] ?? 0) - (1 - alpha) * (backing[channel] ?? 0)) / Math.max(alpha, 0.025)
    data[at * 4 + channel] = Math.max(0, Math.min(255, Math.round(unmixed)))
  }
}

/** Key a drawn picture's flat background out: transparent where the key colour dominates, the garment opaque, and
 * the edge between feathered, its colour unmixed from the background so no green or magenta fringe remains. None
 * when the result fails v1's checks: a border that is not mostly key colour, nothing removed, or the garment gone. */
export const chromaKey = (picture: Rgba, key: KeyColour): Option.Option<Rgba> => {
  const { width, height } = picture
  const total = width * height
  const keyPixels = keyPixelsOf(picture, key)
  const nearKey = widened(keyPixels, width, height, keyArea.reach)
  const backing = borderColour(picture)
  const data = new Uint8Array(picture.data)
  const counts = { border: 0, borderKey: 0, cleared: 0, opaque: 0 }
  for (let at = 0; at < total; at++) {
    if (onBorder(at, width, height)) {
      counts.border += 1
      counts.borderKey += keyPixels[at] ?? 0
    }
    const alpha = opacityOf(data, at, key, nearKey[at] === 1)
    if (alpha === 0) counts.cleared += 1
    else if (alpha === 1) counts.opaque += 1
    else unmix(data, at, alpha, backing)
    data[at * 4 + 3] = Math.round(alpha * 255)
  }
  const borderIsKey = counts.borderKey >= borderKeyShare * counts.border
  const removed = counts.cleared >= clearShare * total
  const garmentRemains = counts.opaque >= opaqueShare * total
  return borderIsKey && removed && garmentRemains ? Option.some({ width, height, data }) : Option.none()
}
