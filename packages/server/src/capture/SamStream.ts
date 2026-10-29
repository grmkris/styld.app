import { decodeMaskToRaster, formats, frameIndexOf, recordsOfKind } from '@meta-sam/parser'
import { Option, Schema } from 'effect'
import type { Box, Mask } from './Pixels.ts'

/** One garment SAM found: its mask in source pixels, its confidence and (for a video) its track and frame. */
export interface Found extends Mask {
  readonly track: string
  readonly frame: number
  readonly confidence: number
}

/** What a finished stream reports beside its masks. */
export interface StreamEnd {
  readonly completed: boolean
  /** Frames SAM billed for a video (`usage.video_frames_processed`). */
  readonly framesBilled: number | undefined
}

const ResponsesEvent = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.String,
    delta: Schema.optionalKey(Schema.String),
    response: Schema.optionalKey(
      Schema.Struct({
        usage: Schema.optionalKey(Schema.Struct({ video_frames_processed: Schema.optionalKey(Schema.Number) })),
      }),
    ),
  }),
)
const decodeEvent = Schema.decodeUnknownOption(ResponsesEvent)

/**
 * Reads a Responses API event stream chunk by chunk and hands out the model's output text one line at a
 * time. SAM writes one line per object and frame (`<12f>3<|box;…;w=1280;h=704|><|mask;…|>`), so a
 * caller can keep only the frames it needs without holding the whole answer.
 */
export const makeOutputLines = () => {
  let pendingEvent = ''
  let pendingLine = ''
  let completed = false
  let framesBilled: number | undefined
  const take = (data: string, lines: Array<string>) => {
    Option.map(decodeEvent(data), (event) => {
      if (event.type === 'response.output_text.delta' && event.delta !== undefined) {
        const parts = `${pendingLine}${event.delta}`.split('\n')
        pendingLine = parts.pop() ?? ''
        lines.push(...parts)
      }
      if (event.type === 'response.completed') {
        completed = true
        framesBilled = event.response?.usage?.video_frames_processed
      }
    })
  }
  const push = (chunk: string): ReadonlyArray<string> => {
    const lines: Array<string> = []
    const parts = `${pendingEvent}${chunk}`.split('\n')
    pendingEvent = parts.pop() ?? ''
    for (const part of parts) if (part.startsWith('data:')) take(part.slice(5).trim(), lines)
    return lines
  }
  const finish = (): { readonly lines: ReadonlyArray<string>; readonly end: StreamEnd } => {
    const lines = [...push('\n')]
    if (pendingLine !== '') lines.push(pendingLine)
    pendingLine = ''
    return { lines, end: { completed, framesBilled } }
  }
  return { push, finish }
}

const frameOfLine = /^<(\d+)f>/
const frameSize = /;w=(\d+);h=(\d+)[;|]/

/** The frame a SAM output line describes, or none for a still's line. */
export const lineFrame = (line: string): number | undefined => {
  const match = frameOfLine.exec(line)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

/** The source frame size SAM saw (`w`/`h` on its box tokens), from any line that carries one. */
export const lineFrameSize = (line: string): { readonly width: number; readonly height: number } | undefined => {
  const match = frameSize.exec(line)
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { width: Number(match[1]), height: Number(match[2]) }
}

const masksOf = (kind: 'image' | 'video', lines: ReadonlyArray<string>): ReadonlyArray<Found> => {
  const parser = formats.segmentation[kind]().createParser()
  parser.push(lines.map((line) => `${line}\n`).join(''))
  const { result } = parser.finish({ status: 'completed' })
  return recordsOfKind(result.records, 'mask').flatMap((record) => {
    const bounds: Box = record.bounds
    const width = bounds.right - bounds.left
    const height = bounds.bottom - bounds.top
    if (width < 1 || height < 1 || width !== record.mask.width || height !== record.mask.height) return []
    const raster = decodeMaskToRaster(record.mask)
    if (raster.length !== width * height) return []
    return [
      { track: record.objectId, frame: frameIndexOf(record) ?? 0, confidence: record.confidence ?? 0, bounds, raster },
    ]
  })
}

/** Every garment in a still's output lines. */
export const stillMasks = (lines: ReadonlyArray<string>) => masksOf('image', lines)

/** Every garment in a video's output lines (pass only the frames you need). */
export const videoMasks = (lines: ReadonlyArray<string>) => masksOf('video', lines)
