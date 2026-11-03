import { encodePng, readPng, type Rgba } from '@styld/imaging'
import { Effect, Layer, Option } from 'effect'
import { type Garment, Garments } from '../../src/capture/Garments.ts'

// The garment pipeline as the native suite runs it: the local stack has no Cloudflare Images, Clef or SAM for an
// arbitrary photo, so every picture shows one garment, cut out as the picture itself (a PNG passes through as it was
// uploaded; any other picture is a grey oval), of a kind the decision model cannot tell. A piece's own photo shows
// nothing to cut out, so a piece added keeps its photo (and its credit back), which never goes public: the social
// journeys give a piece its cut-out themselves (`SocialFixture.ts`). What the native journeys prove is everything after
// the pipeline: detections and cut-outs in the tray, clean pictures drawn from kept cut-outs, an outfit photo's
// garments and its person cut out, and what each costs. The pipeline's own rules are unit-tested on recorded provider
// answers (`Garments.test.ts`, `CaptureProviders.test.ts`, `SamPrompts.test.ts`).

/** A garment-shaped grey oval on transparency. */
const oval = (): Rgba => {
  const width = 120
  const height = 160
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (((x - 60) / 48) ** 2 + ((y - 80) / 68) ** 2 <= 1) data.set([128, 128, 128, 255], (y * width + x) * 4)
  return { width, height, data }
}

/** The one garment a picture shows. */
const garmentIn = (bytes: Uint8Array): Garment => {
  const passed = readPng(bytes)
  const picture = Option.getOrElse(passed, oval)
  return {
    picture,
    png: Option.isSome(passed) ? bytes : encodePng(picture),
    track: '0',
    confidence: 1,
    suggestion: {
      type: undefined,
      confidence: 0,
      colours: [],
      seasons: [],
      rainproof: false,
      occasions: [],
      pattern: undefined,
      whole: 0.5,
    },
    // Of a kind nobody told: offered unticked, as the live pipeline offers a garment it cannot name.
    preselect: false,
  }
}

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

export const fakeGarments = Layer.succeed(
  Garments,
  Garments.of({
    find: (photo) => Effect.succeed({ garments: [garmentIn(photo)], route: Option.none(), provider: 'fake' }),
    cut: (photo, intent) => Effect.succeed(intent.for === 'person' ? Option.some(garmentIn(photo).png) : Option.none()),
    forget: () => Effect.void,
    handOver: () => Effect.succeed('fake-file'),
    // A video shows one garment, at its sharpest still.
    track: (video) =>
      Effect.gen(function* () {
        const [sharpest] = video.stills.toSorted((a, b) => sum(b.sharpness) - sum(a.sharpness))
        if (sharpest === undefined) return []
        const bytes = yield* video.read(sharpest.key)
        return Option.match(bytes, {
          onNone: () => [],
          onSome: (still) => [{ ...garmentIn(still), still: sharpest.key }],
        })
      }),
  }),
)
