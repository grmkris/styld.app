/**
 * Just enough of the ISO base media format (MP4 and QuickTime MOV) to count a video's frames. SAM numbers
 * the frames of the clip it tracks, and the browser samples stills by time, so frame count over duration
 * maps one to the other. Reads only box headers and the `moov` box, wherever the file keeps it.
 */

interface BoxHeader {
  readonly type: string
  readonly start: number
  readonly size: number
  readonly headerSize: number
}

const fourCc = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))

const headerAt = (bytes: Uint8Array, at: number, end: number): BoxHeader | undefined => {
  if (at + 8 > end) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const short = view.getUint32(at)
  const type = fourCc(bytes, at + 4)
  if (short === 1) {
    if (at + 16 > end) return undefined
    return { type, start: at, size: Number(view.getBigUint64(at + 8)), headerSize: 16 }
  }
  return { type, start: at, size: short === 0 ? end - at : short, headerSize: 8 }
}

/** The direct children of the box whose payload spans `from`..`to`. */
const children = (bytes: Uint8Array, from: number, to: number): ReadonlyArray<BoxHeader> => {
  const found: Array<BoxHeader> = []
  for (let at = from; at < to;) {
    const header = headerAt(bytes, at, to)
    if (header === undefined || header.size < header.headerSize) break
    found.push(header)
    at += header.size
  }
  return found
}

const child = (bytes: Uint8Array, parent: BoxHeader, type: string) =>
  children(bytes, parent.start + parent.headerSize, parent.start + parent.size).find((box) => box.type === type)

/** A track's `stts` box, if the track is video. */
const videoStts = (moov: Uint8Array, trak: BoxHeader) => {
  const mdia = child(moov, trak, 'mdia')
  if (mdia === undefined) return undefined
  const hdlr = child(moov, mdia, 'hdlr')
  // hdlr payload: version and flags (4), pre-defined (4), then the handler type.
  if (hdlr === undefined || fourCc(moov, hdlr.start + hdlr.headerSize + 8) !== 'vide') return undefined
  const minf = child(moov, mdia, 'minf')
  const stbl = minf === undefined ? undefined : child(moov, minf, 'stbl')
  return stbl === undefined ? undefined : child(moov, stbl, 'stts')
}

/** The video track's frame count from a `moov` box (the sum of its `stts` sample counts). */
export const videoFrameCount = (moov: Uint8Array): number | undefined => {
  const root = headerAt(moov, 0, moov.byteLength)
  if (root?.type !== 'moov') return undefined
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const tracks = children(moov, root.headerSize, root.size).filter((box) => box.type === 'trak')
  const stts = tracks.map((trak) => videoStts(moov, trak)).find((box) => box !== undefined)
  if (stts === undefined) return undefined
  // stts payload: version and flags (4), entry count (4), then (sample count, sample delta) pairs.
  const first = stts.start + stts.headerSize
  const entries = view.getUint32(first + 4)
  let frames = 0
  for (let entry = 0; entry < entries; entry++) frames += view.getUint32(first + 8 + entry * 8)
  return frames
}

/** Find and read the `moov` box of a stored file, given a ranged reader and the file's size. */
export const readMoov = async (
  readRange: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
): Promise<Uint8Array | undefined> => {
  for (let at = 0; at + 8 <= size;) {
    const header = headerAt(await readRange(at, Math.min(16, size - at)), 0, Math.min(16, size - at))
    if (header === undefined || header.size < header.headerSize) return undefined
    const boxSize = header.size === size - at && header.headerSize === 8 ? size - at : header.size
    // A moov larger than 8 MB is not a phone clip of a minute or less.
    if (header.type === 'moov') return boxSize > 8_000_000 ? undefined : readRange(at, boxSize)
    at += boxSize
  }
  return undefined
}
