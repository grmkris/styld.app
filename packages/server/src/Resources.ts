import * as Cloudflare from '@alchemy.run/cloudflare'

/**
 * v2 owns its Cloudflare data plane. These resources are intentionally named
 * independently from Styld v1 so preview deploys cannot adopt or mutate v1.
 */
export const StyldDatabase = Cloudflare.D1.Database('StyldV2Database', {
  migrations: 'packages/db/migrations',
})

export const StyldMedia = Cloudflare.R2.Bucket('StyldV2Media', {
  jurisdiction: 'eu',
})

/** New pieces wait here for their photo to be prepared (`wardrobe/Processing.ts`). */
export const StyldPieceQueue = Cloudflare.Queues.Queue('StyldV2PieceProcessing')

/** The model's checks of what people make public, retried while a model does not answer. */
export const StyldChecksQueue = Cloudflare.Queues.Queue('StyldV2Checks')

/** Generated pictures and mood boards on their way (`generation/Work.ts`), each step resumed where it stopped. */
export const StyldGenerationQueue = Cloudflare.Queues.Queue('StyldV2Generation')

/** Styld's replies on their way (`stylist/Queue.ts`), one at a time so each starts at once. */
export const StyldStylistQueue = Cloudflare.Queues.Queue('StyldV2Stylist')

/** Every capture provider call and review decision, for cost and keep rates (`tools/ai-usage-report.ts`). */
export const StyldAiCalls = Cloudflare.AnalyticsEngine.Dataset('StyldV2AiCalls')

/** Cloudflare Email Service's `send_email` binding, named `STYLD_EMAIL` in the Worker's env. The
 * styld.app sending domain is already set up in this account, so the stack declares no sending
 * domain or DNS record of its own. */
export const StyldEmail = Cloudflare.Email.SendEmail('STYLD_EMAIL', { allowedSenderAddresses: ['noreply@styld.app'] })

/** The sender every code email comes from. */
export const emailSender = 'Styld <noreply@styld.app>'
