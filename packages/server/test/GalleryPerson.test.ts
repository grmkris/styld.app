import { encodePng } from '@styld/imaging'
import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { Garments } from '../src/capture/Garments.ts'
import { foregroundPerson, wornBy } from '../src/capture/GarmentRules.ts'
import { maskArea } from '../src/capture/Pixels.ts'
import type { Suggestion } from '../src/capture/Providers.ts'
import { scriptedGarments } from './fakes/GarmentPipeline.ts'
import type { Found } from '../src/providers/SamStream.ts'

// T-03 (Eva's review, 2 November, F-16): an outfit photo is of the person nearest the camera, and only what they wear
// or carry is offered, never a bystander's clothes.

/** A filled rectangle SAM found, `track` named. */
const rect = (left: number, top: number, right: number, bottom: number, track: string, confidence = 0.9): Found => ({
  bounds: { left, top, right, bottom },
  raster: new Uint8Array((right - left) * (bottom - top)).fill(1),
  track,
  frame: 0,
  confidence,
})
const withArea = (found: Found) => ({ ...found, area: maskArea(found) })
const size = { width: 400, height: 300 }

describe('the person an outfit photo is of', () => {
  test('the person standing to one side, nearest the camera, beats a smaller bystander in the middle', () => {
    // Eva's carnival photo: she fills the right of the frame; a bystander further back stands in the middle.
    const eva = withArea(rect(250, 20, 390, 300, 'eva'))
    const bystander = withArea(rect(170, 90, 230, 210, 'bystander'))
    expect(foregroundPerson([bystander, eva], size)?.track).toBe('eva')
  })

  test('a bystander behind, partly overlapping, loses to the person in front', () => {
    const eva = withArea(rect(120, 30, 260, 300, 'eva'))
    const behind = withArea(rect(220, 40, 320, 230, 'behind'))
    expect(foregroundPerson([behind, eva], size)?.track).toBe('eva')
  })

  test("SAM's confidence decides between two people the same in the frame", () => {
    const one = withArea(rect(100, 0, 200, 300, 'one', 0.6))
    const other = withArea(rect(200, 0, 300, 300, 'other', 0.95))
    expect(foregroundPerson([one, other], size)?.track).toBe('other')
  })

  test('nobody found is nobody chosen', () => {
    expect(foregroundPerson([], size)).toBeUndefined()
  })
})

describe('what the person wears or carries', () => {
  const eva = rect(250, 20, 390, 300, 'eva')
  test("their dress and a bag beside them count; a bystander's shirt does not", () => {
    const dress = rect(260, 80, 380, 220, '0')
    const shirt = rect(170, 100, 230, 160, '1')
    const bag = rect(220, 150, 245, 190, 'bag-0')
    const farBag = rect(20, 150, 60, 190, 'bag-1')
    expect(wornBy([dress, shirt, bag, farBag], eva).map(({ track }) => track)).toEqual(['0', 'bag-0'])
  })

  test('a garment only touching the person is not theirs', () => {
    const touching = rect(200, 100, 270, 160, '0')
    expect(wornBy([touching], eva)).toEqual([])
  })
})

describe('the Gallery pipeline on a photo with a bystander', () => {
  const { width, height } = size
  const photo = encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(120) })
  const copies = { width, height, png: photo, jpeg: new Uint8Array([1]), small: new Uint8Array([1]) }
  const suggestion: Suggestion = {
    type: 'dresses',
    confidence: 0.9,
    colours: ['brown'],
    seasons: [],
    rainproof: false,
    occasions: [],
    pattern: undefined,
    whole: 0.8,
  }
  const dress = rect(260, 80, 380, 220, '0')
  const shirt = rect(170, 100, 230, 160, '1')
  // Her shoes: under the speck bar for the whole scene (0.4% of 400 × 300 is 480 px), above it for her.
  const shoes = rect(300, 285, 318, 300, '0')
  const run = (people: ReadonlyArray<Found>, prompts: Array<string> = []) =>
    Effect.runPromise(
      Effect.flatMap(Garments, (pipeline) => pipeline.find(photo, { for: 'gallery' })).pipe(
        Effect.provide(
          scriptedGarments({
            copies,
            suggestion,
            still: (_picture, prompt) => {
              prompts.push(prompt)
              if (prompt === 'person') return Effect.succeed(people)
              if (prompt === 'clothing') return Effect.succeed([dress, shirt])
              return Effect.succeed(prompt === 'shoes' ? [shoes] : [])
            },
          }),
        ),
      ),
    )

  test("only the person in front's garments are offered, her small shoes included", async () => {
    const prompts: Array<string> = []
    const { garments } = await run([rect(170, 90, 230, 210, 'bystander'), rect(250, 20, 390, 300, 'eva')], prompts)
    expect(garments.map(({ track }) => track).toSorted()).toEqual(['0', 'shoes-0'])
    expect(prompts.toSorted()).toEqual(['bag', 'clothing', 'hat', 'person', 'shoes'])
  })

  test('with nobody found, every garment counts, as before', async () => {
    const { garments } = await run([])
    expect(garments.map(({ track }) => track).toSorted()).toEqual(['0', '1'])
  })
})
