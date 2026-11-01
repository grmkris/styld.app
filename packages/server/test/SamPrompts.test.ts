import { readFileSync } from 'node:fs'
import { Effect, Redacted } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeGarmentSegmenter } from '../src/capture/Meta.ts'
import { CaptureMetrics } from '../src/capture/Metrics.ts'
import { distinctMasks, samPieces } from '../src/capture/PhotoPipeline.ts'
import { encodePng, overlapShare } from '../src/capture/Pixels.ts'
import { CaptureConfig, capturePolicy } from '../src/capture/Policy.ts'
import { GarmentSegmenter } from '../src/capture/Providers.ts'
import type { Found } from '../src/capture/SamStream.ts'

/** A solid mask over a box. */
const solid = (left: number, top: number, right: number, bottom: number, track = '0'): Found => ({
  bounds: { left, top, right, bottom },
  raster: new Uint8Array((right - left) * (bottom - top)).fill(1),
  track,
  frame: 0,
  confidence: 0.9,
})

describe('masks found for several prompts', () => {
  test('a mask is covered by the share of its pixels another covers too', () => {
    expect(overlapShare(solid(0, 0, 10, 10), solid(0, 0, 10, 10))).toBe(1)
    expect(overlapShare(solid(0, 0, 10, 10), solid(5, 0, 15, 10))).toBe(0.5)
    expect(overlapShare(solid(0, 0, 10, 10), solid(20, 20, 30, 30))).toBe(0)
    // A small shoe inside a large mask is wholly covered; the large mask barely is.
    expect(overlapShare(solid(10, 10, 20, 20), solid(0, 0, 100, 100))).toBe(1)
    expect(overlapShare(solid(0, 0, 100, 100), solid(10, 10, 20, 20))).toBe(0.01)
  })

  test('a shoe found as clothing and again as shoes is one piece; a shoe clothing missed is kept, named', () => {
    const kept = distinctMasks([
      { prompt: 'clothing', found: [solid(0, 0, 100, 100, '0'), solid(200, 0, 230, 20, '1')] },
      { prompt: 'shoes', found: [solid(202, 0, 232, 20, '0'), solid(300, 0, 330, 20, '1')] },
      { prompt: 'bag', found: [solid(302, 0, 332, 20, '0')] },
    ])
    expect(kept.map(({ track }) => track)).toEqual(['0', '1', 'shoes-1'])
  })
})

describe('SAM on a photo of several pieces', () => {
  const fixture = readFileSync(new URL('fixtures/capture/sam-still-rail.sse', import.meta.url)).toString('utf8')
  // The rail frame's size; the pieces are cut from a blank picture, since only the masks are under test.
  const width = 1280
  const height = 704
  const blank = encodePng({ width, height, data: new Uint8Array(width * height * 4) })
  const copies = { width, height, png: blank, jpeg: new Uint8Array([1]), small: new Uint8Array([1]) }
  const config = capturePolicy

  /** SAM answering clothing with the recorded rail, and each other prompt as `other` says. */
  const piecesWith = (other: () => Response) => {
    const asked: Array<string> = []
    const segmenter = makeGarmentSegmenter({
      base: 'https://meta.test',
      key: Redacted.make('key'),
      fetch: (_input, init) => {
        const body = typeof init?.body === 'string' ? init.body : ''
        const prompt = ['clothing', 'shoes', 'bag', 'hat'].find((noun) => body.includes(`"${noun}"`))
        asked.push(prompt ?? 'unknown')
        return Promise.resolve(prompt === 'clothing' ? new Response(fixture) : other())
      },
      readVideo: () => Promise.resolve(null),
      metrics: CaptureMetrics.discarding,
    })
    const pieces = samPieces(copies, ['shoes', 'bag', 'hat']).pipe(
      Effect.provideService(GarmentSegmenter, segmenter),
      Effect.provideService(CaptureConfig, config),
    )
    return Effect.runPromise(pieces).then((found) => ({ found, asked }))
  }

  test('asks once for each prompt, and keeps no piece twice when the others find the same garments', async () => {
    const { found, asked } = await piecesWith(() => new Response(fixture))
    expect(asked.toSorted()).toEqual(['bag', 'clothing', 'hat', 'shoes'])
    expect(found).toHaveLength(10)
    expect(found.every(({ track }) => !track.includes('-'))).toBe(true)
  })

  test('another prompt that fails leaves its pieces out, not the photo', async () => {
    const { found } = await piecesWith(() => new Response('{}', { status: 400 }))
    expect(found).toHaveLength(10)
  })
})
