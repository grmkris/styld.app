import { encodePng, readPng } from '@styld/imaging'
import { Effect, Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { Garments } from '../src/capture/Garments.ts'
import { type Cut, joined, pairsOf, promptsFor } from '../src/capture/GarmentRules.ts'
import type { Picture, Suggestion } from '../src/capture/Providers.ts'
import { scriptedGarments } from './fakes/GarmentPipeline.ts'
import type { Found } from '../src/providers/SamStream.ts'

/** A cut of `area` opaque pixels, `track` named. */
const cut = (track: string, area: number, left = 0): Cut => ({
  picture: { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) },
  bounds: { left, top: 0, right: left + 1, bottom: 1 },
  area,
  track,
  confidence: 0.9,
})

const shoe = ({ track }: Cut) => (track.startsWith('shoe') ? Option.some('shoes') : Option.none())

describe('a pair is one piece', () => {
  test('two of one pair kind close in size pair up; anything else stays on its own', () => {
    const groups = pairsOf([cut('coat', 900), cut('shoe-a', 100), cut('shoe-b', 80), cut('bag', 70)], shoe)
    expect(groups.map((group) => group.map(({ track }) => track))).toEqual([['coat'], ['shoe-a', 'shoe-b'], ['bag']])
  })

  test('a shoe under half the size of the other is not its pair', () => {
    const groups = pairsOf([cut('shoe-a', 100), cut('shoe-b', 40)], shoe)
    expect(groups).toHaveLength(2)
  })

  test('four shoes are two pairs, each with the one nearest its size', () => {
    const groups = pairsOf([cut('shoe-a', 200), cut('shoe-b', 190), cut('shoe-c', 100), cut('shoe-d', 95)], shoe)
    expect(groups.map((group) => group.map(({ track }) => track))).toEqual([
      ['shoe-a', 'shoe-b'],
      ['shoe-c', 'shoe-d'],
    ])
  })

  test('joined, both garments sit in one cut-out over the box that holds both', () => {
    const both = joined(cut('shoe-a', 1, 0), cut('shoe-b', 1, 3))
    expect(both.bounds).toEqual({ left: 0, top: 0, right: 4, bottom: 1 })
    expect([...both.picture.data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255])
    expect(both).toMatchObject({ area: 2, track: 'shoe-a+shoe-b' })
  })
})

const route = (garments: 'one' | 'several', scene?: 'flat') => ({
  garments,
  confidence: 0.9,
  person: 0,
  ...(scene === undefined ? {} : { scene }),
})

describe('what SAM is asked for, by intent', () => {
  test('one table for every intent', () => {
    expect(promptsFor({ for: 'tray', route: route('one') })).toEqual(['clothing'])
    expect(promptsFor({ for: 'tray', route: route('several') })).toEqual(['clothing', 'shoes', 'bag', 'hat'])
    expect(promptsFor({ for: 'tray', route: route('one', 'flat') })).toEqual(['clothing', 'shoes', 'bag', 'hat'])
    expect(promptsFor({ for: 'piece', type: 'boots' })).toEqual(['clothing', 'shoes'])
    expect(promptsFor({ for: 'piece', type: 'jeans' })).toEqual(['clothing'])
    expect(promptsFor('gallery')).toEqual(['clothing', 'shoes', 'bag', 'hat'])
    expect(promptsFor('person')).toEqual(['person'])
    expect(promptsFor('video')).toEqual(['clothing'])
  })
})

const solid = (left: number, track: string): Found => ({
  bounds: { left, top: 20, right: left + 40, bottom: 60 },
  raster: new Uint8Array(40 * 40).fill(1),
  track,
  frame: 0,
  confidence: 0.9,
})
const wide = (picture: { readonly width: number }) => picture.width > 100

describe('the pipeline on two shoes', () => {
  const width = 200
  const height = 100
  const photo = encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(200) })
  const copies = { width, height, png: photo, jpeg: new Uint8Array([1]), small: new Uint8Array([7]) }
  const sources: Array<Option.Option<Picture>> = []
  const suggestion: Suggestion = {
    type: 'trainers',
    confidence: 0.9,
    colours: ['white'],
    seasons: [],
    rainproof: false,
    occasions: [],
    pattern: undefined,
    whole: 0.8,
  }
  const run = <A, E>(use: (pipeline: Garments['Service']) => Effect.Effect<A, E>, person = 0) =>
    Effect.runPromise(
      Effect.flatMap(Garments, use).pipe(
        Effect.provide(
          scriptedGarments({
            copies,
            suggestion,
            sources,
            route: { garments: 'several', confidence: 0.9, person },
            // Clothing misses the shoes; the shoes prompt finds both.
            still: (_picture, prompt) => Effect.succeed(prompt === 'shoes' ? [solid(20, '0'), solid(120, '1')] : []),
          }),
        ),
      ),
    )

  test('the tray offers a pair of trainers as one piece, both shoes in its cut-out', async () => {
    const { garments } = await run((pipeline) => pipeline.find(photo, { for: 'tray', camera: false }))
    expect(garments).toHaveLength(1)
    expect(garments[0]).toMatchObject({ track: 'shoes-0+shoes-1', preselect: true })
    expect(Option.map(readPng(garments[0]?.png ?? new Uint8Array()), wide)).toEqual(Option.some(true))
  })

  test('each shoe is read beside the photo it was cut from, its small working copy', async () => {
    sources.length = 0
    await run((pipeline) => pipeline.find(photo, { for: 'tray', camera: false }))
    expect(sources).toEqual([
      Option.some({ bytes: copies.small, contentType: 'image/jpeg' }),
      Option.some({ bytes: copies.small, contentType: 'image/jpeg' }),
    ])
  })

  test('a pair of boots added as a piece is cut out as one picture of both', async () => {
    // A person in the picture: SAM, not background removal.
    const png = await run((pipeline) => pipeline.cut(photo, { for: 'piece', type: 'boots' }), 0.9)
    expect(Option.map(Option.flatMap(png, readPng), wide)).toEqual(Option.some(true))
  })
})
