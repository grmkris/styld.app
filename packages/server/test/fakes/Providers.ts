import { Layer } from 'effect'
import { capturePolicy, CaptureConfig } from '../../src/capture/Policy.ts'
import { MoodPlanner } from '../../src/generation/Planner.ts'
import { PicturePainter } from '../../src/generation/Painter.ts'
import { clefJudge } from '../../src/outfits/Judge.ts'
import { OutfitModels, providersOver, type ProvidersFor } from '../../src/Providers.ts'
import { fakeJudge, fakePainter, fakePlanner, fakeProposer } from './Models.ts'
import { clefAt, fakeChat, unusedGuard } from './WorkersAi.ts'

/** The fixture Worker's address, which the native stack binds to the API Worker as `TEST_FIXTURES`. */
const fixturesOf = (env: Readonly<Record<string, unknown>>) => {
  const url = env['TEST_FIXTURES']
  if (typeof url !== 'string' || url.length === 0) throw new Error('TEST_FIXTURES binding is required')
  return url
}

/** The native suite's providers: Meta, Muse, Veo and Clef answered by the fixture Worker through the live clients, a
 * turn polled every second, the planner, painter, Thinking and the content judge as fakes, and captures keeping their
 * photos whole (until the garment pipeline has fakes of its own). */
export const nativeProviders: ProvidersFor = (bindings) => {
  const fixtures = fixturesOf(bindings.env)
  const calls = { runClef: clefAt(`${fixtures}/test/pictures/clef`), runChat: fakeChat, runGuard: unusedGuard }
  const live = providersOver(bindings, calls, {
    fetch: (input, init) => globalThis.fetch(input, init),
    metaBase: `${fixtures}/test/pictures/meta`,
    gatewayBase: `${fixtures}/test/pictures/gateway`,
    pollSeconds: 1,
  })
  return Layer.mergeAll(
    live,
    Layer.succeed(CaptureConfig, { ...capturePolicy, providers: 'off' }),
    Layer.succeed(PicturePainter, fakePainter),
    Layer.succeed(MoodPlanner, fakePlanner),
    fakeJudge,
    Layer.succeed(OutfitModels, { judge: clefJudge(calls.runClef, bindings.metrics), proposer: fakeProposer }),
  )
}
