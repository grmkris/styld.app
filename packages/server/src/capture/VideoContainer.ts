/**
 * Just enough of the ISO base media format (MP4 and QuickTime MOV) to count a video's frames, measure its
 * length and find its metadata. SAM numbers the frames of the clip it tracks, and the browser samples
 * stills by time, so frame count over duration maps one to the other. Reads only box headers and the
 * `moov` box, wherever the file keeps it.
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

/** The movie's length in milliseconds, from its `mvhd` box. */
export const videoDurationMs = (moov: Uint8Array): number | undefined => {
  const root = headerAt(moov, 0, moov.byteLength)
  const mvhd = root?.type === 'moov' ? child(moov, root, 'mvhd') : undefined
  if (mvhd === undefined) return undefined
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const at = mvhd.start + mvhd.headerSize
  // Version 0: creation and modification times of 4 bytes each; version 1: of 8 bytes each.
  const wide = view.getUint8(at) === 1
  const timescale = view.getUint32(at + (wide ? 20 : 12))
  const duration = wide ? Number(view.getBigUint64(at + 24)) : view.getUint32(at + 16)
  return timescale === 0 ? undefined : Math.round((duration * 1000) / timescale)
}

/** Boxes where phones keep the place and device a video was recorded with. */
const metadataTypes: ReadonlySet<string> = new Set(['udta', 'meta'])

/** The byte ranges, within the file, of every metadata box in the movie and its tracks, given where the
 * `moov` box starts. Blanking them (type `free`, payload zero) keeps every size and offset as it was. */
export const metadataRanges = (moov: Uint8Array, moovOffset: number) => {
  const root = headerAt(moov, 0, moov.byteLength)
  if (root?.type !== 'moov') return []
  const level = children(moov, root.headerSize, root.size)
  const nested = level
    .filter((box) => box.type === 'trak')
    .flatMap((trak) => children(moov, trak.start + trak.headerSize, trak.start + trak.size))
  return [...level, ...nested]
    .filter((box) => metadataTypes.has(box.type))
    .map((box) => ({ start: moovOffset + box.start, end: moovOffset + box.start + box.size }))
}

/** Blank the parts of `chunk`, which starts at `offset` in its file, that fall inside `ranges`: each
 * box's type becomes `free` and its payload zeros, so the file keeps its shape and loses its metadata. */
export const blankRanges = (
  chunk: Uint8Array,
  offset: number,
  ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
) => {
  const out = new Uint8Array(chunk)
  const free = [0x66, 0x72, 0x65, 0x65]
  for (const { start, end } of ranges)
    for (let at = Math.max(start + 4, offset); at < Math.min(end, offset + chunk.length); at++)
      out[at - offset] = at < start + 8 ? (free[at - start - 4] ?? 0) : 0
  return out
}

/** Find the `moov` box of a stored file and where it starts, given a ranged reader and the file's size. */
export const findMoov = async (
  readRange: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
): Promise<{ readonly bytes: Uint8Array; readonly offset: number } | undefined> => {
  for (let at = 0; at + 8 <= size;) {
    const header = headerAt(await readRange(at, Math.min(16, size - at)), 0, Math.min(16, size - at))
    if (header === undefined || header.size < header.headerSize) return undefined
    const boxSize = header.size === size - at && header.headerSize === 8 ? size - at : header.size
    // A moov larger than 8 MB is not a phone clip of a minute or less.
    if (header.type === 'moov')
      return boxSize > 8_000_000 ? undefined : { bytes: await readRange(at, boxSize), offset: at }
    at += boxSize
  }
  return undefined
}

/** Find and read the `moov` box of a stored file, given a ranged reader and the file's size.
 * @internal Exported for its tests. */
export const readMoov = async (
  readRange: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
): Promise<Uint8Array | undefined> => (await findMoov(readRange, size))?.bytes
