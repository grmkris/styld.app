import { Layer } from 'effect'
import { makeTextCompletions, TextCompletions } from './Text.ts'
import { makeGarmentVision, type RunClef } from './Clef.ts'
import { makePictureWork } from './CloudflareImages.ts'
import { makeGarmentSegmenter, metaBase } from './Meta.ts'
import type { Bucket, ImagesBinding } from '../kernel/Media.ts'
import { CaptureMetrics } from '../kernel/Metrics.ts'
import { makeMuseGenerator, makeMusePainter, makeMuseTryOn } from './Muse.ts'
import { Garments } from '../capture/Garments.ts'
import { GarmentSegmenter, GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from '../capture/Providers.ts'
import { gatewayBase, makeVeoGenerator, veoPollSeconds } from './Veo.ts'
import type { Deployment } from '../Config.ts'
import type { Fetch } from './Http.ts'
import { Checkouts } from '../billing/Checkouts.ts'
import { makeDodoCheckouts } from './Dodo.ts'
import { PicturePainter } from '../generation/Painter.ts'
import { TryOnPainter } from '../generation/TryOnPainter.ts'
import { MoodPlanner } from '../generation/Planner.ts'
import { OutfitJudge } from '../outfits/Judge.ts'
import { Thinking } from '../outfits/Proposer.ts'
import { ContentJudge, contentJudge } from '../safety/Judge.ts'

// Every provider the application runs on, as layers: the decision model, image work, SAM, the image and video models,
// the planner and Thinking, the content judge and the paid text gateway. The Worker
// passes the live ones; the native test composition passes its fakes (`packages/server/test/fakes/`). Nothing in here
// reads the environment.

/** What the application's provider layer gives it.
 * @internal Exported for its tests. */
export type ProviderServices =
  | Garments
  | GarmentVision
  | PictureWork
  | GarmentSegmenter
  | ImageGenerator
  | VideoGenerator
  | PicturePainter
  | TryOnPainter
  | MoodPlanner
  | ContentJudge
  | OutfitJudge
  | Thinking
  | TextCompletions
  | Checkouts

/** What providers are built over: the Worker's own bindings, its call counter and its deployment's secrets.
 * @internal Exported for its tests. */
export interface ProviderBindings {
  /** Workers AI over the Worker's `AI` binding. */
  readonly workersAi: WorkersAiCalls
  readonly images: ImagesBinding
  readonly bucket: Bucket
  readonly metrics: CaptureMetrics['Service']
  readonly deployment: Deployment['Service']
  /** The Worker's environment: only a test composition reads anything from it. */
  readonly env: Readonly<Record<string, unknown>>
}

/** How a composition makes its providers. */
export type ProvidersFor = (bindings: ProviderBindings) => Layer.Layer<ProviderServices>

/** The Workers AI calls Styld makes over the Worker's `AI` binding: Clef's questions. */
export interface WorkersAiCalls {
  readonly runClef: RunClef
}

/** The providers from their Workers AI calls and their HTTP clients' fetch and addresses. The native composition
 * builds these over its fixture Worker, then lays its fakes over the ones it replaces.
 * @internal Exported for its tests. */
export const providersOver = (
  bindings: ProviderBindings,
  calls: WorkersAiCalls,
  http: {
    readonly fetch: Fetch
    readonly metaBase: string
    readonly gatewayBase: string
    readonly textBase: string
    readonly pollSeconds: number
  },
): Layer.Layer<ProviderServices> => {
  const { metrics, deployment } = bindings
  const meta = { base: http.metaBase, key: deployment.secrets.metaApiKey, fetch: http.fetch, metrics }
  const veo = {
    base: http.gatewayBase,
    key: deployment.secrets.videoGatewayKey,
    fetch: http.fetch,
    metrics,
    pollSeconds: http.pollSeconds,
  }
  const readVideo = async (key: string) => (await bindings.bucket.get(key))?.body ?? null
  const garmentProviders = Layer.mergeAll(
    Layer.succeed(GarmentVision, makeGarmentVision(calls.runClef, metrics)),
    Layer.succeed(PictureWork, makePictureWork(bindings.images, metrics)),
    Layer.succeed(GarmentSegmenter, makeGarmentSegmenter({ ...meta, readVideo })),
  )
  const text = makeTextCompletions({ base: http.textBase, key: deployment.secrets.textKey, fetch: http.fetch })
  // Text uses the paid gateway; Clef continues over Workers AI.
  const models = Layer.mergeAll(
    MoodPlanner.layer,
    Thinking.layer,
    contentJudge(calls.runClef),
    OutfitJudge.layer(calls.runClef),
  ).pipe(
    Layer.provideMerge(Layer.succeed(TextCompletions, text)),
    Layer.provide(Layer.succeed(CaptureMetrics, metrics)),
  )
  return Layer.mergeAll(
    Garments.layer.pipe(Layer.provideMerge(garmentProviders)),
    Layer.succeed(ImageGenerator, makeMuseGenerator(meta)),
    Layer.succeed(VideoGenerator, makeVeoGenerator(veo)),
    Layer.succeed(PicturePainter, makeMusePainter(meta)),
    Layer.succeed(Checkouts, makeDodoCheckouts(deployment.billing, http.fetch)),
    Layer.succeed(TryOnPainter, makeMuseTryOn(meta)),
    models,
  )
}

/** The Worker's providers: Clef through its binding, Meta and both gateways over the internet. */
export const liveProviders: ProvidersFor = (bindings) =>
  providersOver(bindings, bindings.workersAi, {
    fetch: (input, init) => globalThis.fetch(input, init),
    metaBase,
    gatewayBase,
    textBase: bindings.deployment.textBase,
    pollSeconds: veoPollSeconds,
  })
