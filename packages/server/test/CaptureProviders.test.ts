import { readFileSync } from 'node:fs'
import { Effect, Exit, Option, Redacted } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeGarmentVision } from '../src/capture/Clef.ts'
import { pngSize } from '../src/capture/CloudflareImages.ts'
import { bestSightings, frameAt, type SampledStill } from '../src/capture/FrameRanking.ts'
import { makeGarmentSegmenter } from '../src/capture/Meta.ts'
import { CaptureMetrics } from '../src/capture/Metrics.ts'
import { type Box, cutOut, decodePng, encodePng, opaqueBounds, type Rgba } from '../src/capture/Pixels.ts'
import { lineFrame, lineFrameSize, makeOutputLines, stillMasks, videoMasks } from '../src/capture/SamStream.ts'
import { readMoov, videoFrameCount } from '../src/capture/VideoContainer.ts'

const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))
const bytes = (name: string) => new Uint8Array(fixture(name))
const text = (name: string) => fixture(name).toString('utf8')

/** Feed a recorded stream in uneven chunks, as the network would deliver it. */
const linesOf = (sse: string, chunk = 977) => {
  const reader = makeOutputLines()
  const lines: Array<string> = []
  for (let at = 0; at < sse.length; at += chunk) lines.push(...reader.push(sse.slice(at, at + chunk)))
  const end = reader.finish()
  return { lines: [...lines, ...end.lines], end: end.end }
}

const run = <A, E>(effect: Effect.Effect<A, E, CaptureMetrics>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(CaptureMetrics.discard)))
/** The error an effect fails with (it must fail). */
const errorOf = <A, E>(effect: Effect.Effect<A, E, CaptureMetrics>) =>
  Effect.runPromise(effect.pipe(Effect.flip, Effect.provide(CaptureMetrics.discard)))

/** Whether a cut-out shows a pixel of the photo it was cut from. */
const shown = (piece: Rgba, bounds: Box, row: number, column: number) => {
  const inside = column >= bounds.left && row >= bounds.top && column < bounds.right && row < bounds.bottom
  return inside && (piece.data[((row - bounds.top) * piece.width + column - bounds.left) * 4 + 3] ?? 0) > 0
}

/** How well a cut-out matches the drawn truth: the share of their union both cover. */
const overlapWith = (truth: Rgba, piece: Rgba, bounds: Box) => {
  let inBoth = 0
  let inEither = 0
  for (let at = 0; at < truth.width * truth.height; at++) {
    const inside = shown(piece, bounds, Math.floor(at / truth.width), at % truth.width)
    const truly = (truth.data[at * 4] ?? 0) > 127
    if (inside && truly) inBoth++
    if (inside || truly) inEither++
  }
  return inBoth / inEither
}

const still = (index: number, sharp: number): SampledStill => ({
  index,
  atMs: index * 1000,
  width: 100,
  height: 100,
  sharpness: Array.from({ length: 64 }, () => sharp),
})

const box = (left: number, right: number) => ({ left, top: 20, right, bottom: 80 })

/** Clef-flash answering every question with `answer`. */
const answering = (answer: unknown) => makeGarmentVision(() => Promise.resolve(answer), CaptureMetrics.discarding)

/** One Clef choice answer, sure of `choice` with `probability`. */
const chose = (choice: string, probability: number) => ({ choice, probabilities: { [choice]: probability } })

/** SAM answering every request with `answer`. */
const segmenter = (answer: () => Response) =>
  makeGarmentSegmenter({
    apiBase: 'https://meta.test',
    apiKey: Redacted.make('key'),
    fetch: () => Promise.resolve(answer()),
    readVideo: () => Promise.resolve(null),
    metrics: CaptureMetrics.discarding,
  })

const railFrame = { bytes: bytes('rail-frame.jpg'), contentType: 'image/jpeg' } as const

/** What SAM's still call fails with when Meta answers `code`. */
const refusedWith = (code: number) =>
  errorOf(segmenter(() => new Response('{}', { status: code })).still(railFrame, 'clothing'))

describe('SAM answers', () => {
  test('a still finds every garment on the rail, whatever the chunking', () => {
    for (const chunk of [64, 977, 1 << 20]) {
      const { lines, end } = linesOf(text('sam-still-rail.sse'), chunk)
      expect(end.completed).toBe(true)
      expect(stillMasks(lines)).toHaveLength(10)
    }
  })

  test('a video keeps only the frames asked for, and reports the frames billed and the frame size', () => {
    const { lines, end } = linesOf(text('sam-video-tiny-rail.sse'))
    expect(end.framesBilled).toBe(50)
    expect(lineFrameSize(lines[0] ?? '')).toEqual({ width: 160, height: 112 })
    const wanted = new Set([0, 10, 47])
    const kept = videoMasks(lines.filter((line) => wanted.has(lineFrame(line) ?? -1)))
    expect(kept.map(({ frame }) => frame)).toEqual([0, 10, 47])
    expect(new Set(kept.map(({ track }) => track)).size).toBe(1)
  })
})

describe('cut-outs from real pixels', () => {
  test('the SAM mask keeps the drawn tee and nothing else', () => {
    const picture = decodePng(bytes('red-tee.png'))
    const [mask] = stillMasks(linesOf(text('sam-still-red-tee.sse')).lines)
    if (mask === undefined) throw new Error('the recording holds one mask')
    const piece = cutOut(picture, mask)
    expect(overlapWith(decodePng(bytes('red-tee-truth.png')), piece, mask.bounds)).toBeGreaterThan(0.98)
    // The original pixels survive untouched inside the mask, and the PNG round-trips.
    const again = decodePng(encodePng(piece))
    expect(again).toMatchObject({ width: piece.width, height: piece.height })
    expect(again.data).toEqual(piece.data)
    expect(opaqueBounds(piece)).toBeDefined()
  })

  test('reads a PNG size from its header', () => {
    expect(pngSize(bytes('red-tee.png'))).toEqual({ width: 768, height: 768 })
  })
})

describe('video stills', () => {
  test('counts the frames of MP4 clips', async () => {
    for (const [name, frames] of [
      ['tiny-rail.mp4', 48],
      ['rail-ten-640.mp4', 241],
    ] as const) {
      const clip = bytes(name)
      const moov = await readMoov(
        (offset, length) => Promise.resolve(clip.subarray(offset, offset + length)),
        clip.length,
      )
      expect(moov === undefined ? undefined : videoFrameCount(moov)).toBe(frames)
    }
  })

  test('maps a still to the frame on screen at its time', () => {
    expect(frameAt(0, 241, 10_042)).toBe(0)
    expect(frameAt(5_000, 241, 10_042)).toBe(120)
    expect(frameAt(20_000, 241, 10_042)).toBe(240)
  })

  test('picks the sharpest, largest, unobstructed sighting away from the frame edge', () => {
    const stills = new Map([
      [10, still(0, 0.2)],
      [20, still(1, 0.9)],
      [30, still(2, 0.9)],
    ])
    const best = bestSightings(
      [
        { track: 'a', frame: 10, bounds: box(20, 60), area: 2400, confidence: 0.9 },
        { track: 'a', frame: 20, bounds: box(20, 60), area: 2400, confidence: 0.9 },
        { track: 'a', frame: 30, bounds: box(0, 60), area: 3000, confidence: 0.9 },
      ],
      stills,
    )
    expect(best.map(({ sighting }) => sighting.frame)).toEqual([20])
  })
})

describe('Clef-flash', () => {
  const picture = { bytes: bytes('red-tee.png'), contentType: 'image/png' } as const

  test('routes one garment to background removal and the rail to SAM', async () => {
    const one = await run(answering(JSON.parse(text('clef-route-red-tee.json'))).route(picture))
    expect(one).toEqual(Exit.succeed({ garments: 'one', confidence: 0.9672 }))
    const several = await run(answering(JSON.parse(text('clef-route-rail-ten.json'))).route(picture))
    expect(Exit.isSuccess(several) && several.value.garments).toBe('several')
  })

  test('suggests only a subcategory that fits and a second colour it is fairly sure of', async () => {
    const suggestion = await run(
      answering({
        answers: {
          category: chose('bottom', 0.8),
          subcategory: chose('long_sleeve', 0.7),
          colour: chose('navy', 0.6),
          secondColour: chose('white', 0.4),
        },
      }).suggest(picture),
    )
    expect(suggestion).toEqual(
      Exit.succeed({ category: 'bottom', confidence: 0.8, subcategory: undefined, colours: ['navy', 'white'] }),
    )
  })

  test('confirms a held garment and its side, and fails retryably when Workers AI does', async () => {
    const held = await run(
      answering({
        answers: {
          held: { noul: 0.91 },
          side: { choice: 'back', probabilities: { back: 0.8 } },
          samePrevious: { noul: 0.88 },
        },
      }).checkHeld(picture, Option.some(picture)),
    )
    expect(held).toEqual(Exit.succeed({ held: 0.91, side: 'back', samePrevious: 0.88 }))
    const down = await errorOf(
      makeGarmentVision(() => Promise.reject(new Error('down')), CaptureMetrics.discarding).route(picture),
    )
    expect(down).toMatchObject({ _tag: 'ProviderFailed', retryable: true })
  })
})

describe('Meta SAM', () => {
  test('segments every garment in a still', async () => {
    const found = await run(segmenter(() => new Response(text('sam-still-rail.sse'))).still(railFrame, 'clothing'))
    expect(Exit.isSuccess(found) && found.value.length).toBe(10)
  })

  test('tells a refusal from a failure worth retrying', async () => {
    expect(await refusedWith(400)).toMatchObject({ _tag: 'ProviderFailed', retryable: false })
    expect(await refusedWith(503)).toMatchObject({ _tag: 'ProviderFailed', retryable: true })
  })

  test("retries Meta's model_not_found in place, then leaves it to the queue", async () => {
    let calls = 0
    const misrouted = makeGarmentSegmenter({
      apiBase: 'https://meta.test',
      apiKey: Redacted.make('key'),
      fetch: () => {
        calls++
        return Promise.resolve(new Response('{"error":{"code":"model_not_found"}}', { status: 404 }))
      },
      readVideo: () => Promise.resolve(null),
      metrics: CaptureMetrics.discarding,
    })
    expect(await errorOf(misrouted.still(railFrame, 'clothing'))).toMatchObject({ retryable: true })
    expect(calls).toBe(4)
  })

  test('calls a stream that breaks after Meta accepted the request an unknown outcome', async () => {
    const cut = text('sam-still-rail.sse').split('event: response.completed')[0] ?? ''
    expect(await errorOf(segmenter(() => new Response(cut)).still(railFrame, 'clothing'))).toMatchObject({
      _tag: 'ProviderOutcomeUnknown',
    })
  })

  test('tracks a video and keeps only the frames asked for', async () => {
    const tracked = await run(
      segmenter(() => new Response(text('sam-video-tiny-rail.sse'))).track('file_1', 'clothing', new Set([0, 24])),
    )
    expect(Exit.isSuccess(tracked) && tracked.value.found.map(({ frame }) => frame)).toEqual([0, 24])
    expect(Exit.isSuccess(tracked) && tracked.value.framesBilled).toBe(50)
  })
})
