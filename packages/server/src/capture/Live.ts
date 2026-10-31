import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Layer, Redacted } from 'effect'
import type { RunPlanner } from '../generation/Planner.ts'
import { generationProviders } from '../generation/Providers.ts'
import type { WardrobeBindings } from '../wardrobe/Wardrobe.ts'
import { type ClefRequest, makeGarmentVision, type RunClef } from './Clef.ts'
import { makePictureWork } from './CloudflareImages.ts'
import { makeGarmentSegmenter } from './Meta.ts'
import { type AnalyticsDataset, analyticsEngine, CaptureMetrics } from './Metrics.ts'
import { makeMuseGenerator } from './Muse.ts'
import { CaptureConfig, capturePolicy } from './Policy.ts'
import { GarmentSegmenter, GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './Providers.ts'
import { Usage } from './Usage.ts'
import { makeVeoGenerator } from './Veo.ts'

// The capture providers as the API Worker builds them from its environment and bindings.

/** The capture providers and policy from the Worker's environment. */
export const captureProviders = (
  env: Cloudflare.Workers.WorkerEnvironment['Service'],
  runtime: {
    readonly runClef: RunClef
    readonly runPlanner: RunPlanner
    readonly images: WardrobeBindings['images']
    readonly bucket: WardrobeBindings['bucket']
    readonly dataset: AnalyticsDataset
    readonly origin: { readonly environment: string; readonly release: string }
  },
) => {
  const policy = capturePolicy(env)
  const metrics = analyticsEngine(runtime.dataset, runtime.origin)
  const apiKey: unknown = env.META_API_KEY
  const apiBase: unknown = env.META_API_BASE
  const videoKey: unknown = env.VIDEO_GATEWAY_API_KEY
  const videoBase: unknown = env.VIDEO_GATEWAY_BASE
  const meta = {
    apiBase: typeof apiBase === 'string' && apiBase.length > 0 ? apiBase : 'https://api.meta.ai',
    apiKey: Redacted.make(typeof apiKey === 'string' ? apiKey : ''),
    fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init),
    metrics,
  }
  return Layer.mergeAll(
    Layer.succeed(CaptureConfig, policy),
    Layer.succeed(GarmentVision, makeGarmentVision(runtime.runClef, metrics)),
    Layer.succeed(PictureWork, makePictureWork(runtime.images, metrics)),
    Layer.succeed(
      GarmentSegmenter,
      makeGarmentSegmenter({ ...meta, readVideo: async (key) => (await runtime.bucket.get(key))?.body ?? null }),
    ),
    Layer.succeed(ImageGenerator, policy.pictures.generator === 'muse' ? makeMuseGenerator(meta) : ImageGenerator.off),
    generationProviders(env.GENERATED_PICTURES, meta, runtime.runPlanner),
    Layer.succeed(
      VideoGenerator,
      policy.turns.generator === 'veo'
        ? makeVeoGenerator({
            apiBase:
              typeof videoBase === 'string' && videoBase.length > 0 ? videoBase : 'https://ai-gateway.vercel.sh/v4/ai',
            apiKey: Redacted.make(typeof videoKey === 'string' ? videoKey : ''),
            fetch: meta.fetch,
            metrics,
          })
        : VideoGenerator.off,
    ),
    Usage.layer(policy.dailyAllowance),
    Layer.succeed(CaptureMetrics, metrics),
  )
}

/** Clef asked over HTTP, as a stand-in answers it on the native stack. */
export const askStandIn = async (url: string, request: ClefRequest): Promise<unknown> => {
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(`Clef stand-in answered ${response.status}`)
  return response.json()
}
