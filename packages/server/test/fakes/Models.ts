import { refused, outcomeUnknown } from '../../src/providers/Errors.ts'
import { encodePng, type KeyColour } from '@styld/imaging'
import { Effect, Layer, Option } from 'effect'
import { type Picture } from '../../src/capture/Providers.ts'
import type { PicturePainter } from '../../src/generation/Painter.ts'
import { type MoodPlanner, planOf } from '../../src/generation/Planner.ts'
import { nothingKept, type Thinking } from '../../src/outfits/Proposer.ts'
import { proposed } from '../../src/outfits/Rules.ts'
import { ContentJudge, instructionsIn, passed, worse } from '../../src/safety/Judge.ts'

// The native suite's models: deterministic, answering by markers in the person's words, so a journey can ask for a
// refusal or a lost answer. Each is the service the Worker's live provider is.

const side = 64
const keyRgb = { green: [0, 255, 0], magenta: [255, 0, 255] } as const

/** A dark square in the middle of a flat key colour, which keys out as a real drawing does. */
const keyablePicture = (key: KeyColour): Picture => {
  const data = new Uint8Array(side * side * 4)
  for (let at = 0; at < side * side; at++) {
    const row = Math.floor(at / side)
    const column = at % side
    const inside = row >= 16 && row < 48 && column >= 16 && column < 48
    const [red, green, blue] = inside ? [40, 30, 90] : keyRgb[key]
    data.set([red, green, blue, 255], at * 4)
  }
  return { bytes: encodePng({ width: side, height: side, data }), contentType: 'image/png' }
}

/** The sticker painter: a keyable picture for any words, refused for `[[refuse]]`, lost on the way for `[[lost]]`. */
export const fakePainter: PicturePainter['Service'] = {
  paint: (request) => {
    if (request.prompt.includes('[[refuse]]')) return Effect.fail(refused('fake'))
    if (request.prompt.includes('[[lost]]')) return Effect.fail(outcomeUnknown('fake'))
    return Effect.succeed(keyablePicture(request.key))
  },
}

/** The mood-board planner: the first three pieces picked; `[[unclear]]` plans nothing. */
export const fakePlanner: MoodPlanner['Service'] = {
  plan: (request) =>
    Effect.succeed(
      request.sentence.includes('[[unclear]]')
        ? Option.none()
        : planOf({ refuse: false, picks: request.wardrobe.slice(0, 3).map(({ ref }) => ref), moods: [] }, request),
    ),
}

/** Thinking: the rules' outfits from a seed of its own; `[[unclear]]` in the person's words answers nothing usable. */
export const fakeProposer: Thinking['Service'] = {
  propose: (request, count) =>
    request.brief.words?.includes('[[unclear]]') === true
      ? Effect.fail(nothingKept())
      : Effect.succeed({ outfits: proposed(request, 'thinking', count).outfits, costMicroUsd: 0 }),
}

/** The content judge: words with `[[fail]]` fail and `[[unsure]]` are unsure, pictures pass, and text that addresses
 * an assistant is unsure as it is live. */
export const fakeJudge = Layer.succeed(
  ContentJudge,
  ContentJudge.of({
    judge: (content) =>
      Effect.succeed(
        worse(
          content.texts.some((text) => text.includes('[[fail]]'))
            ? { state: 'failed', reason: 'other', model: 'fake' }
            : content.texts.some((text) => text.includes('[[unsure]]'))
              ? { state: 'unsure', reason: 'other', model: 'fake' }
              : passed,
          instructionsIn(content.texts),
        ),
      ),
  }),
)
