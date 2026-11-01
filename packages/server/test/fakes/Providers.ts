import { Layer } from 'effect'
import { MoodPlanner } from '../../src/generation/Planner.ts'
import { PicturePainter } from '../../src/generation/Painter.ts'
import { Thinking } from '../../src/outfits/Proposer.ts'
import { providersOver, type ProvidersFor } from '../../src/Providers.ts'
import { fakeGarments } from './Garments.ts'
import { fakeJudge, fakePainter, fakePlanner, fakeProposer } from './Models.ts'
import { clefAt, fakeChat } from './WorkersAi.ts'

/** The fixture Worker's address, which the native stack binds to the API Worker as `TEST_FIXTURES`. */
const fixturesOf = (env: Readonly<Record<string, unknown>>) => {
  const url = env['TEST_FIXTURES']
  if (typeof url !== 'string' || url.length === 0) throw new Error('TEST_FIXTURES binding is required')
  return url
}

/** The native suite's providers: Muse, Veo and Clef answered by the fixture Worker through the live clients, a turn
 * polled every second, Styld's language model over a played chat model, and the garment pipeline, planner, painter,
 * Thinking and the content judge as fakes. */
export const nativeProviders: ProvidersFor = (bindings) => {
  const fixtures = fixturesOf(bindings.env)
  const live = providersOver(
    bindings,
    { runClef: clefAt(`${fixtures}/test/pictures/clef`), runModel: fakeChat },
    {
      fetch: (input, init) => globalThis.fetch(input, init),
      metaBase: `${fixtures}/test/pictures/meta`,
      gatewayBase: `${fixtures}/test/pictures/gateway`,
      pollSeconds: 1,
    },
  )
  return Layer.mergeAll(
    live,
    fakeGarments,
    Layer.succeed(PicturePainter, fakePainter),
    Layer.succeed(MoodPlanner, fakePlanner),
    Layer.succeed(Thinking, fakeProposer),
    fakeJudge,
  )
}
