import { readFileSync } from 'node:fs'
import type { PieceType } from '@styld/protocol'
import { Effect, Exit, Option, Redacted } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeGarmentVision } from '../src/providers/Clef.ts'
import { pngSize } from '../src/providers/CloudflareImages.ts'
import { bestSightings, frameAt, type SampledStill } from '../src/capture/FrameRanking.ts'
import { makeGarmentSegmenter } from '../src/providers/Meta.ts'
import { analyticsEngine, CaptureMetrics } from '../src/kernel/Metrics.ts'
import { cutterFor, holding, kindPrompt, pieceOfKind, verdictOf } from '../src/capture/GarmentRules.ts'
import { decodePng, opaqueBounds } from '@styld/imaging'
import { type Box, encodePng, type Rgba } from '@styld/imaging'
import { cutOut, fitMask } from '../src/capture/Pixels.ts'
import { lineFrame, lineFrameSize, makeOutputLines, stillMasks, videoMasks } from '../src/providers/SamStream.ts'
import {
  blankRanges,
  findMoov,
  metadataRanges,
  readMoov,
  videoDurationMs,
  videoFrameCount,
} from '../src/capture/VideoContainer.ts'

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
    base: 'https://meta.test',
    key: Redacted.make('key'),
    fetch: () => Promise.resolve(answer()),
    readVideo: () => Promise.resolve(null),
    metrics: CaptureMetrics.discarding,
  })

const railFrame = { bytes: bytes('rail-frame.jpg'), contentType: 'image/jpeg' } as const

/** What SAM's still call fails with when Meta answers `code`. */
const refusedWith = (code: number) =>
  errorOf(segmenter(() => new Response('{}', { status: code })).still(railFrame, 'clothing'))

/** A recorded SAM line on a picture twice the size: the same mask raster under a box twice as large, which is
 * how SAM answers for a garment over 1024 px. */
const doubled = (line: string) =>
  line.replace(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)/, (_match, ...values: Array<string>) => {
    const [x1, y1, x2, y2, w, h] = values.slice(0, 6).map(Number)
    return `<|box;x1=${2 * (x1 ?? 0)};y1=${2 * (y1 ?? 0)};x2=${2 * (x2 ?? 0) + 1};y2=${2 * (y2 ?? 0) + 1};w=${2 * (w ?? 0)};h=${2 * (h ?? 0)}`
  })

describe('SAM answers', () => {
  test('a still finds every garment on the rail, whatever the chunking', () => {
    for (const chunk of [64, 977, 1 << 20]) {
      const { lines, end } = linesOf(text('sam-still-rail.sse'), chunk)
      expect(end.completed).toBe(true)
      expect(stillMasks(lines)).toHaveLength(10)
    }
  })

  test("a garment larger than SAM's 1024 px raster cap is scaled to its box, not dropped", () => {
    const { lines } = linesOf(text('sam-still-red-tee.sse'))
    const [original] = stillMasks(lines)
    const [large] = stillMasks(lines.map(doubled))
    if (original === undefined || large === undefined) throw new Error('both answers hold the tee')
    const width = (mask: typeof original) => mask.bounds.right - mask.bounds.left
    expect(width(large)).toBe(2 * width(original))
    expect(large.raster.length).toBe(width(large) * (large.bounds.bottom - large.bounds.top))
    const area = (mask: typeof original) => mask.raster.reduce((sum, value) => sum + (value === 0 ? 0 : 1), 0)
    expect(area(large)).toBe(4 * area(original))
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
    // Compared as bytes: a deep toEqual walks the 2.3 million entries one by one and took seconds under load.
    expect(again.data.length === piece.data.length && again.data.every((value, at) => value === piece.data[at])).toBe(
      true,
    )
    expect(opaqueBounds(piece)).toBeDefined()
  })

  test('a mask scaled onto a larger still keeps its own shape, and takes nothing from the row before', () => {
    // SAM's 406 px frame onto a 720 px still, as for a portrait video. The mask fills only its right half,
    // so its left edge rounds outwards when scaled.
    const width = 10
    const height = 6
    const raster = Uint8Array.from({ length: width * height }, (_, at) => (at % width >= 5 ? 1 : 0))
    const fitted = fitMask(
      { bounds: { left: 37, top: 100, right: 37 + width, bottom: 100 + height }, raster },
      { width: 406, height: 720 },
      { width: 720, height: 1280 },
    )
    const fittedWidth = fitted.bounds.right - fitted.bounds.left
    const rows = Array.from({ length: fitted.bounds.bottom - fitted.bounds.top }, (_row, row) =>
      Array.from({ length: fittedWidth }, (_column, column) => fitted.raster[row * fittedWidth + column] ?? 0),
    )
    const filledFrom = Math.ceil((37 + 5) * (720 / 406)) - fitted.bounds.left
    // The empty half stays empty in every row, including the first column that used to wrap.
    for (const row of rows) expect(row.slice(0, filledFrom - 1).every((value) => value === 0)).toBe(true)
    // The filled half is filled; the edge rounded outwards is not part of the mask.
    for (const row of rows.slice(1, -1)) expect(row.slice(filledFrom + 1, -1).every((value) => value === 1)).toBe(true)
    expect(rows[0]?.every((value) => value === 0)).toBe(true)
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

  test('measures a clip and finds its metadata boxes, which blanking turns into free space', async () => {
    const clip = bytes('rail-ten-640.mp4')
    const moov = await findMoov(
      (offset, length) => Promise.resolve(clip.subarray(offset, offset + length)),
      clip.length,
    )
    if (moov === undefined) throw new Error('the clip has a moov box')
    expect(moov.offset).toBe(32)
    expect(videoDurationMs(moov.bytes)).toBeGreaterThan(9_900)
    expect(videoDurationMs(moov.bytes)).toBeLessThan(10_200)
    const ranges = metadataRanges(moov.bytes, moov.offset)
    expect(ranges.length).toBeGreaterThan(0)
    // Blanked in uneven chunks, as the upload streams it: every metadata box becomes `free` and zeros.
    const sent = new Uint8Array(clip.length)
    for (let at = 0; at < clip.length; at += 1000) sent.set(blankRanges(clip.subarray(at, at + 1000), at, ranges), at)
    for (const { start, end } of ranges) {
      expect(new TextDecoder().decode(sent.subarray(start + 4, start + 8))).toBe('free')
      expect(sent.subarray(start + 8, end).every((value) => value === 0)).toBe(true)
      expect(sent.subarray(start, start + 4)).toEqual(clip.subarray(start, start + 4))
    }
    // Everything else is untouched, so offsets and sizes still hold.
    const outside = (at: number) => ranges.every(({ start, end }) => at < start + 4 || at >= end)
    expect(Array.from(clip.keys()).every((at) => !outside(at) || sent[at] === clip[at])).toBe(true)
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

  test('reads how many garments show and whether a person does, assuming one when unanswered', async () => {
    const held = await run(answering(JSON.parse(text('clef-route-held-person.json'))).route(picture))
    expect(held).toEqual(Exit.succeed({ garments: 'one', confidence: 0.8612, person: 0.9258 }))
    // Recorded before the person question: a person is assumed, which keeps it from background removal.
    const one = await run(answering(JSON.parse(text('clef-route-red-tee.json'))).route(picture))
    expect(one).toEqual(Exit.succeed({ garments: 'one', confidence: 0.9672, person: 1 }))
    const several = await run(answering(JSON.parse(text('clef-route-rail-ten.json'))).route(picture))
    expect(Exit.isSuccess(several) && several.value.garments).toBe('several')
  })

  test('reads the scene when it is fairly sure of it, and none when unanswered or unsure', async () => {
    // A real photo of one garment laid out, from the person-routing spike (only the answer is kept).
    const laid = await run(answering(JSON.parse(text('clef-route-laid-flat.json'))).route(picture))
    expect(laid).toEqual(Exit.succeed({ garments: 'one', confidence: 0.9388, person: 0.0058, scene: 'flat' }))
    const unanswered = await run(answering(JSON.parse(text('clef-route-held-person.json'))).route(picture))
    expect(Exit.isSuccess(unanswered) && 'scene' in unanswered.value).toBe(false)
    const unsure = await run(
      answering({ answers: { garments: chose('several', 0.9), scene: chose('flat', 0.45) } }).route(picture),
    )
    expect(Exit.isSuccess(unsure) && 'scene' in unsure.value).toBe(false)
  })

  test('suggests a type with how sure the model is of its group, its attributes, and a second colour it is fairly sure of', async () => {
    const suggestion = await run(
      answering({
        answers: {
          type: { choice: 'jeans', probabilities: { jeans: 0.5, trousers: 0.3, trainers: 0.1, none: 0.1 } },
          colour: chose('navy', 0.6),
          secondColour: chose('white', 0.4),
          season: chose('cold', 0.7),
          rain: chose('rain', 0.8),
          occasion: { choice: 'casual', probabilities: { casual: 0.55, smart: 0.36, formal: 0.05, sport: 0.04 } },
          pattern: chose('plain', 0.9),
          whole: chose('part', 0.7),
        },
      }).suggest(picture),
    )
    expect(suggestion).toEqual(
      Exit.succeed({
        type: 'jeans',
        confidence: 0.8,
        colours: ['navy', 'white'],
        // Cold weather is autumn and winter (T-12); made for rain.
        seasons: ['autumn', 'winter'],
        rainproof: true,
        occasions: ['casual', 'smart'],
        pattern: 'plain',
        // `chose` gives only the chosen answer a probability, so "whole" has none.
        whole: 0,
      }),
    )
    const unsure = await run(answering({ answers: { type: chose('none', 0.9) } }).suggest(picture))
    expect(Exit.isSuccess(unsure) && unsure.value.type).toBe(undefined)
  })

  test('confirms a held garment and its side, and fails retryably when Workers AI does', async () => {
    const held = await run(
      answering({
        answers: {
          held: { noul: 0.91 },
          side: { choice: 'back', probabilities: { back: 0.8 } },
          samePrevious: { noul: 0.88 },
          holding: { noul: 0.97 },
        },
      }).checkHeld(picture, Option.some(picture), 'held'),
    )
    expect(held).toEqual(Exit.succeed({ held: 0.91, side: 'back', samePrevious: 0.88, holding: 0.97 }))
    const down = await errorOf(
      makeGarmentVision(() => Promise.reject(new Error('down')), CaptureMetrics.discarding).route(picture),
    )
    expect(down).toMatchObject({ _tag: 'ProviderError', reason: { _tag: 'Busy' } })
  })
})

/** A route with nobody in the picture. */
const route = (garments: 'none' | 'one' | 'several', confidence: number) => ({ garments, confidence, person: 0.02 })

describe('photo routing', () => {
  test('one garment it is sure of goes to background removal; several, or an unsure answer, to SAM', () => {
    expect(cutterFor('tray', route('one', 0.9))).toBe('cloudflare')
    expect(cutterFor('tray', route('one', 0.6))).toBe('sam')
    expect(cutterFor('tray', route('several', 0.9))).toBe('sam')
    expect(cutterFor('tray', route('none', 0.9))).toBe('none')
    expect(cutterFor('tray', route('none', 0.5))).toBe('sam')
  })

  test('a whole garment is preselected, part of one offered unticked, and a scrap dropped', () => {
    expect([0.95, 0.5, 0.49, 0.2, 0.19, 0].map(verdictOf)).toEqual([
      'preselect',
      'preselect',
      'offer',
      'offer',
      'drop',
      'drop',
    ])
  })

  test('a photo with a person goes to SAM even as one garment: background removal would keep the person', () => {
    // The recorded answer for someone holding up one garment: sure of one, and a person.
    expect(cutterFor('tray', { garments: 'one', confidence: 0.8612, person: 0.9258 })).toBe('sam')
    expect(cutterFor('tray', { garments: 'one', confidence: 0.94, person: 0.5 })).toBe('sam')
    // A piece laid flat, nobody in the picture, from the camera or the library alike.
    expect(cutterFor('tray', { garments: 'one', confidence: 0.94, person: 0.04 })).toBe('cloudflare')
    expect(cutterFor('tray', { garments: 'none', confidence: 0.9, person: 0.9 })).toBe('none')
  })

  test('a piece’s own photo goes whole to background removal, unless a person is in it', () => {
    // A v1 product shot of a pair of boots (1 November): unsure between one and two, nobody in it.
    expect(cutterFor('piece', { garments: 'several', confidence: 0.68, person: 0.0055 })).toBe('cloudflare')
    expect(cutterFor('piece', { garments: 'one', confidence: 0.47, person: 0.0076, scene: 'other' })).toBe('cloudflare')
    expect(cutterFor('piece', { garments: 'one', confidence: 0.86, person: 0.93 })).toBe('sam')
  })

  test('SAM looks for a piece of shoes, a bag or a hat by its kind, and takes its largest', () => {
    const kinds: ReadonlyArray<PieceType> = ['boots', 'trainers', 'bags', 'hats', 'jeans', 'scarves']
    expect(kinds.map(kindPrompt)).toEqual([
      Option.some('shoes'),
      Option.some('shoes'),
      Option.some('bag'),
      Option.some('hat'),
      Option.none(),
      Option.none(),
    ])
    // Largest first: a person's coat as clothing, then one boot of a pair found as shoes.
    const found = [{ track: '0' }, { track: 'shoes-1' }, { track: 'shoes-2' }]
    expect(pieceOfKind(found, Option.some('shoes'))).toEqual(Option.some({ track: 'shoes-1' }))
    expect(pieceOfKind(found.slice(0, 1), Option.some('shoes'))).toEqual(Option.some({ track: '0' }))
    expect(pieceOfKind(found, Option.none())).toEqual(Option.some({ track: '0' }))
    expect(pieceOfKind([], Option.none())).toEqual(Option.none())
  })

  test('a camera shot or a person makes one piece the subject, unless the pieces are laid out', () => {
    const library = false
    const camera = true
    expect(holding(library, route('several', 0.9))).toBe(false)
    expect(holding(camera, route('several', 0.9))).toBe(true)
    expect(holding(library, { ...route('several', 0.9), person: 0.93 })).toBe(true)
    expect(holding(library, { ...route('several', 0.9), person: 0.93, scene: 'worn' })).toBe(true)
    // Pieces laid out on a bed with a hand at the edge, or under the camera held above them.
    expect(holding(library, { ...route('several', 0.9), person: 0.93, scene: 'flat' })).toBe(false)
    expect(holding(camera, { ...route('one', 0.9), scene: 'flat' })).toBe(false)
  })
})

describe('Meta SAM', () => {
  test('segments every garment in a still', async () => {
    const found = await run(segmenter(() => new Response(text('sam-still-rail.sse'))).still(railFrame, 'clothing'))
    expect(Exit.isSuccess(found) && found.value.length).toBe(10)
  })

  test('tells a refusal from a failure worth retrying', async () => {
    expect(await refusedWith(400)).toMatchObject({ _tag: 'ProviderError', reason: { _tag: 'Refused' } })
    expect(await refusedWith(503)).toMatchObject({ _tag: 'ProviderError', reason: { _tag: 'Busy' } })
  })

  test("retries Meta's model_not_found in place, then leaves it to the queue", async () => {
    let calls = 0
    const misrouted = makeGarmentSegmenter({
      base: 'https://meta.test',
      key: Redacted.make('key'),
      fetch: () => {
        calls++
        return Promise.resolve(new Response('{"error":{"code":"model_not_found"}}', { status: 404 }))
      },
      readVideo: () => Promise.resolve(null),
      metrics: CaptureMetrics.discarding,
    })
    expect(await errorOf(misrouted.still(railFrame, 'clothing'))).toMatchObject({ reason: { _tag: 'Busy' } })
    expect(calls).toBe(4)
  })

  test('calls a stream that breaks after Meta accepted the request an unknown outcome', async () => {
    const cut = text('sam-still-rail.sse').split('event: response.completed')[0] ?? ''
    expect(await errorOf(segmenter(() => new Response(cut)).still(railFrame, 'clothing'))).toMatchObject({
      _tag: 'ProviderError',
      reason: { _tag: 'OutcomeUnknown' },
    })
  })

  test('deletes a video only when Meta confirms it, or has no such file', async () => {
    const forget = (status: number) =>
      run(segmenter(() => new Response(status === 204 ? null : '{}', { status })).forget('file_1'))
    expect(Exit.isSuccess(await forget(200))).toBe(true)
    expect(Exit.isSuccess(await forget(204))).toBe(true)
    expect(Exit.isSuccess(await forget(404))).toBe(true)
    expect(await errorOf(segmenter(() => new Response('{}', { status: 500 })).forget('file_1'))).toMatchObject({
      reason: { _tag: 'Busy' },
    })
    expect(await errorOf(segmenter(() => new Response('{}', { status: 403 })).forget('file_1'))).toMatchObject({
      reason: { _tag: 'Refused' },
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

describe('provider metering', () => {
  test('writes each call under its own provider and kind, with no account, prompt or picture', async () => {
    const points: Array<unknown> = []
    const metrics = analyticsEngine(
      { writeDataPoint: (point) => points.push(point) },
      { environment: 'preview', release: 'r1' },
    )
    await Effect.runPromise(
      metrics.call({
        provider: 'clef',
        model: 'clef-flash',
        kind: 'route',
        outcome: 'ok',
        milliseconds: 420,
        units: 650,
        costMicroUsd: 25,
      }),
    )
    await Effect.runPromise(metrics.review({ route: 'tray', provider: 'any', decision: 'kept' }))
    expect(points).toEqual([
      {
        indexes: ['call.clef.route'],
        blobs: ['preview', 'r1', 'clef', 'clef-flash', 'route', 'ok'],
        doubles: [420, 650, 25],
      },
      { indexes: ['review.kept'], blobs: ['preview', 'r1', 'tray', 'any', 'kept'], doubles: [1] },
    ])
  })
})
