import type { LanguageModel } from 'effect/ai'
import { Context, Layer } from 'effect'
import { type RunChat } from './ai/WorkersAiFetch.ts'
import { makeGarmentVision, type RunClef } from './capture/Clef.ts'
import { makePictureWork } from './capture/CloudflareImages.ts'
import { makeGarmentSegmenter, metaBase } from './capture/Meta.ts'
import type { CaptureMetrics } from './capture/Metrics.ts'
import { makeMuseGenerator, makeMusePainter } from './capture/Muse.ts'
import { CaptureConfig } from './capture/Policy.ts'
import { GarmentSegmenter, GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './capture/Providers.ts'
import { gatewayBase, makeVeoGenerator, veoPollSeconds } from './capture/Veo.ts'
import type { Deployment } from './Config.ts'
import { PicturePainter } from './generation/Painter.ts'
import { livePlanner, MoodPlanner } from './generation/Planner.ts'
import { clefJudge, type OutfitJudge } from './outfits/Judge.ts'
import { liveProposer, type OutfitProposer, thinkingModel } from './outfits/Proposer.ts'
import { ContentJudge, contentJudge, type RunGuard } from './safety/Judge.ts'
import { stylistModel } from './stylist/Live.ts'
import type { WardrobeBindings } from './wardrobe/Parts.ts'

// Every provider the application runs on, as layers: the decision model, image work, SAM, the image and video models,
// the planner and Thinking, the content judge and the model Styld answers with. The Worker passes the live ones; the
// native test composition passes its fakes (`packages/server/test/fakes/`). Nothing in here reads the environment.

/** Clef's outfit ranking and Thinking's model, for the outfit engine. */
export class OutfitModels extends Context.Service<
  OutfitModels,
  { readonly judge: OutfitJudge; readonly proposer: OutfitProposer }
>()('@styld/server/OutfitModels') {}

/** The language model Styld, the stylist in the app, answers with, and its name for the call counter. */
export class StylistModel extends Context.Service<
  StylistModel,
  { readonly model: string; readonly layer: Layer.Layer<LanguageModel.LanguageModel> }
>()('@styld/server/StylistModel') {}

/** What the application's provider layer gives it. */
export type ProviderServices =
  | CaptureConfig
  | GarmentVision
  | PictureWork
  | GarmentSegmenter
  | ImageGenerator
  | VideoGenerator
  | PicturePainter
  | MoodPlanner
  | ContentJudge
  | OutfitModels
  | StylistModel

/** What providers are built over: the Worker's own bindings, its call counter and its deployment's secrets. */
export interface ProviderBindings {
  /** Workers AI over the Worker's `AI` binding. */
  readonly workersAi: WorkersAiCalls
  readonly images: WardrobeBindings['images']
  readonly bucket: WardrobeBindings['bucket']
  readonly metrics: CaptureMetrics['Service']
  readonly deployment: Deployment
  /** The Worker's environment: only a test composition reads anything from it. */
  readonly env: Readonly<Record<string, unknown>>
}

/** How a composition makes its providers. */
export type ProvidersFor = (bindings: ProviderBindings) => Layer.Layer<ProviderServices>

/** The three Workers AI calls Styld makes, over the Worker's `AI` binding. */
export interface WorkersAiCalls {
  readonly runClef: RunClef
  readonly runChat: RunChat
  readonly runGuard: RunGuard
}

/** The providers from their Workers AI calls and their HTTP clients' fetch and addresses. The native composition
 * builds these over its fixture Worker, then lays its fakes over the ones it replaces. */
export const providersOver = (
  bindings: ProviderBindings,
  calls: WorkersAiCalls,
  http: {
    readonly fetch: (input: string, init: RequestInit) => Promise<Response>
    readonly metaBase: string
    readonly gatewayBase: string
    readonly pollSeconds: number
  },
): Layer.Layer<ProviderServices> => {
  const { metrics, deployment } = bindings
  const meta = { apiBase: http.metaBase, apiKey: deployment.secrets.metaApiKey, fetch: http.fetch, metrics }
  const veo = {
    apiBase: http.gatewayBase,
    apiKey: deployment.secrets.videoGatewayKey,
    fetch: http.fetch,
    metrics,
    pollSeconds: http.pollSeconds,
  }
  const readVideo = async (key: string) => (await bindings.bucket.get(key))?.body ?? null
  return Layer.mergeAll(
    CaptureConfig.layer,
    Layer.succeed(GarmentVision, makeGarmentVision(calls.runClef, metrics)),
    Layer.succeed(PictureWork, makePictureWork(bindings.images, metrics)),
    Layer.succeed(GarmentSegmenter, makeGarmentSegmenter({ ...meta, readVideo })),
    Layer.succeed(ImageGenerator, makeMuseGenerator(meta)),
    Layer.succeed(VideoGenerator, makeVeoGenerator(veo)),
    Layer.succeed(PicturePainter, makeMusePainter(meta)),
    Layer.succeed(MoodPlanner, livePlanner(calls.runChat, metrics)),
    contentJudge({ ...calls, metrics }),
    Layer.succeed(OutfitModels, {
      judge: clefJudge(calls.runClef, metrics),
      proposer: liveProposer(calls.runChat, metrics, thinkingModel),
    }),
    Layer.succeed(StylistModel, stylistModel(calls.runChat)),
  )
}

/** The Worker's providers: Workers AI through its binding, Meta and the gateway over the internet. */
export const liveProviders: ProvidersFor = (bindings) =>
  providersOver(bindings, bindings.workersAi, {
    fetch: (input, init) => globalThis.fetch(input, init),
    metaBase,
    gatewayBase,
    pollSeconds: veoPollSeconds,
  })
