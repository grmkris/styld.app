/**
 * A live check of the SAM video path against Meta's API, run by hand (it costs about $0.05):
 *
 *   bun tools/provider-live.ts packages/server/test/fixtures/capture/rail-ten-640.mp4 [seconds-between-stills]
 *
 * Uploads the clip through the Files API, tracks "clothing" with the same adapter the Worker uses,
 * keeps one frame a second, and prints the tracks found, the frames billed and the time taken. Reads
 * META_MUSE_API_KEY from the environment and never prints it.
 */
import { readFile } from 'node:fs/promises'
import { Effect, Redacted, Schema } from 'effect'
import { makeGarmentSegmenter } from '../packages/server/src/capture/Meta.ts'
import { CaptureMetrics } from '../packages/server/src/capture/Metrics.ts'
import { readMoov, videoFrameCount } from '../packages/server/src/capture/VideoContainer.ts'

const [path, every = '1'] = process.argv.slice(2)
const key = process.env['META_MUSE_API_KEY']
if (path === undefined || key === undefined)
  throw new Error('Usage: bun tools/provider-live.ts <clip.mp4>, with META_MUSE_API_KEY set')
const clip = new Uint8Array(await readFile(path))
const moov = await readMoov((offset, length) => Promise.resolve(clip.subarray(offset, offset + length)), clip.length)
const frames = moov === undefined ? undefined : videoFrameCount(moov)
if (frames === undefined) throw new Error('Not an MP4 or MOV clip with a video track')

const apiBase = 'https://api.meta.ai'
const started = Date.now()
// Bun's fetch sends a Blob of known length; the Worker streams the same multipart from R2 instead.
const form = new FormData()
form.append('purpose', 'user_data')
form.append('file', new Blob([clip], { type: 'video/mp4' }), 'wardrobe.mp4')
const uploaded = await fetch(`${apiBase}/v1/files`, {
  method: 'POST',
  headers: { authorization: `Bearer ${key}` },
  body: form,
})
if (!uploaded.ok) throw new Error(`The Files API answered ${uploaded.status}`)
const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await uploaded.json())
const uploadMs = Date.now() - started

const fps = frames / 10.04
const wanted = new Set(
  Array.from({ length: Math.floor(frames / (fps * Number(every))) + 1 }, (_, n) => Math.round(n * fps * Number(every))),
)
const segmenter = makeGarmentSegmenter({
  base: apiBase,
  key: Redacted.make(key),
  fetch: (input, init) => fetch(input, init),
  readVideo: () => Promise.resolve(null),
  metrics: CaptureMetrics.discarding,
})
const result = await Effect.runPromise(segmenter.track(id, 'clothing', wanted))
const tracks = new Set(result.found.map(({ track }) => track))
console.log(
  JSON.stringify(
    {
      frames,
      framesBilled: result.framesBilled,
      stillsKept: wanted.size,
      masksKept: result.found.length,
      tracks: tracks.size,
      uploadMs,
      totalMs: Date.now() - started,
      estimatedUsd: (result.framesBilled * 0.0002).toFixed(4),
    },
    null,
    2,
  ),
)
