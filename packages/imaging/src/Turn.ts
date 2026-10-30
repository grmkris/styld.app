import { crop, opaqueBounds, type Rgba, shrink } from './Raster.ts'

// A turn's canvas, as the 30 October spikes used it with Veo 3.1 Lite (portrait 720p): the garment fits in 560 by 860
// with its top 230 pixels down, under a wooden hanger as wide as nine tenths of its shoulders.
export const turnCanvas = { width: 720, height: 1280 } as const
const garmentBox = { width: 560, height: 860, top: 230 }
const hangerSpan = 0.92
// The hanger's apex sits this far above the garment's collar, so its wood shows above the neckline.
const apexAboveCollar = 22

const keyColours = { green: [0, 255, 0], magenta: [255, 0, 255] } as const

/** `picture` cut to its visible pixels, or as it is when nothing is. */
export const trimmed = (picture: Rgba, threshold = 8) => {
  const box = opaqueBounds(picture, threshold)
  return box === undefined ? picture : crop(picture, box)
}

/** One channel of `picture` at a fractional position, blended from its four neighbours. */
export const sampled = (picture: Rgba, x: number, y: number, channel: number) => {
  const left = Math.max(0, Math.min(picture.width - 1, Math.floor(x)))
  const top = Math.max(0, Math.min(picture.height - 1, Math.floor(y)))
  const right = Math.min(picture.width - 1, left + 1)
  const bottom = Math.min(picture.height - 1, top + 1)
  const across = Math.max(0, Math.min(1, x - left))
  const down = Math.max(0, Math.min(1, y - top))
  const at = (column: number, row: number) => picture.data[(row * picture.width + column) * 4 + channel] ?? 0
  const upper = at(left, top) * (1 - across) + at(right, top) * across
  const lower = at(left, bottom) * (1 - across) + at(right, bottom) * across
  return upper * (1 - down) + lower * down
}

/** `picture` scaled by `factor`: averaged down, or blended up. */
export const scaled = (picture: Rgba, factor: number): Rgba => {
  if (factor <= 1) return shrink(picture, Math.max(1, Math.round(Math.max(picture.width, picture.height) * factor)))
  const width = Math.round(picture.width * factor)
  const height = Math.round(picture.height * factor)
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++)
      for (let channel = 0; channel < 4; channel++)
        data[(row * width + column) * 4 + channel] = Math.round(
          sampled(picture, (column + 0.5) / factor - 0.5, (row + 0.5) / factor - 0.5, channel),
        )
  return { width, height, data }
}

/** Pixel `from` of `top` blended over pixel `to` of `under`: ordinary alpha compositing, in place. */
const blend = (under: Uint8Array, to: number, top: Uint8Array, from: number) => {
  const alpha = (top[from + 3] ?? 0) / 255
  const below = (under[to + 3] ?? 0) / 255
  const total = alpha + below * (1 - alpha)
  for (let channel = 0; channel < 3; channel++) {
    const mixed = (top[from + channel] ?? 0) * alpha + (under[to + channel] ?? 0) * below * (1 - alpha)
    under[to + channel] = total === 0 ? 0 : Math.round(mixed / total)
  }
  under[to + 3] = Math.round(total * 255)
}

/** `top` laid over `under` with its corner at (`left`, `upper`), in place; what falls outside is dropped. */
const over = (under: Rgba, top: Rgba, left: number, upper: number) => {
  const columns = { from: Math.max(0, -left), to: Math.min(top.width, under.width - left) }
  for (let row = Math.max(0, -upper); row < Math.min(top.height, under.height - upper); row++)
    for (let column = columns.from; column < columns.to; column++)
      blend(under.data, ((upper + row) * under.width + left + column) * 4, top.data, (row * top.width + column) * 4)
}

const blankCanvas = (): Rgba => ({
  width: turnCanvas.width,
  height: turnCanvas.height,
  data: new Uint8Array(turnCanvas.width * turnCanvas.height * 4),
})

/** The first row of `picture` with an opaque pixel near its middle column: where a garment's collar starts. */
const collarRow = (picture: Rgba) => {
  const middle = Math.floor(picture.width / 2)
  for (let row = 0; row < picture.height; row++)
    for (let column = Math.max(0, middle - 20); column < Math.min(picture.width, middle + 20); column++)
      if ((picture.data[(row * picture.width + column) * 4 + 3] ?? 0) > 128) return row
  return 0
}

/** How wide the opaque pixels of `row` span, from the first to the last. */
const spanOf = (picture: Rgba, row: number) => {
  let first = -1
  let last = -1
  for (let column = 0; column < picture.width; column++)
    if ((picture.data[(row * picture.width + column) * 4 + 3] ?? 0) > 128) {
      if (first < 0) first = column
      last = column
    }
  return first < 0 ? picture.width : last - first
}

/** A turn's last frame: the clean picture top-centred on the turn's canvas under the wooden hanger, transparent
 * around them (the 30 October spikes' front anchor). Real drawing pixels only; nothing is generated. */
export const frontAnchor = (clean: Rgba, hanger: Rgba): Rgba => {
  const trim = trimmed(clean)
  const garment = scaled(trim, Math.min(garmentBox.width / trim.width, garmentBox.height / trim.height))
  const span = spanOf(garment, Math.floor(garment.height / 6))
  const wood = scaled(hanger, (span * hangerSpan) / hanger.width)
  const canvas = blankCanvas()
  const apex = garmentBox.top + collarRow(garment) - apexAboveCollar
  over(canvas, wood, Math.floor((turnCanvas.width - wood.width) / 2), Math.max(0, apex))
  over(canvas, garment, Math.floor((turnCanvas.width - garment.width) / 2), garmentBox.top)
  return canvas
}

/** `picture` laid on its flat key colour, opaque: how a frame is given to a model that draws on that colour. */
export const onKey = (picture: Rgba, key: 'green' | 'magenta'): Rgba => {
  const ground: Rgba = { width: picture.width, height: picture.height, data: new Uint8Array(picture.data.length) }
  for (let at = 0; at < ground.data.length; at += 4) ground.data.set([...keyColours[key], 255], at)
  over(ground, picture, 0, 0)
  return ground
}

/** The middle column of the topmost few rows of `picture`: where a side view's hanger apex is. */
const apexColumn = (picture: Rgba, top: number) => {
  const columns: Array<number> = []
  for (let row = top; row < Math.min(picture.height, top + 6); row++)
    for (let column = 0; column < picture.width; column++)
      if ((picture.data[(row * picture.width + column) * 4 + 3] ?? 0) > 20) columns.push(column)
  return columns.toSorted((a, b) => a - b)[Math.floor(columns.length / 2)] ?? picture.width / 2
}

/** A keyed side view fitted to its front anchor: a quarter-turn keeps the garment's height, so one scale sets its
 * length to the front's, with the hanger's apex at the same height on the canvas's middle column. None when either
 * picture shows nothing. */
export const fitSide = (side: Rgba, front: Rgba): Rgba | undefined => {
  const frontBox = opaqueBounds(front, 20)
  const sideBox = opaqueBounds(side, 20)
  if (frontBox === undefined || sideBox === undefined) return undefined
  const factor = (frontBox.bottom - frontBox.top) / (sideBox.bottom - sideBox.top)
  const apex = apexColumn(side, sideBox.top)
  const resized = scaled(side, factor)
  const canvas = blankCanvas()
  over(
    canvas,
    resized,
    Math.round(turnCanvas.width / 2 - apex * factor),
    Math.round(frontBox.top - sideBox.top * factor),
  )
  return canvas
}
