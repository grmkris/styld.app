import { Environment } from '@styld/observability'
import { Config, ConfigProvider, Effect, Schema } from 'effect'
import {
  decodeAuthSecret,
  decodeAuthSessionKeyring,
  decodeProofKeyring,
  decodeRequestBindingKeyring,
} from './AuthConfiguration.ts'
import { adminEmails } from './social/Curation.ts'

// What the API Worker is told about its deployment, and nothing else: which stage and release it is, its public origin,
// its secrets, and who administers it. Decoded once, when the application is built; a missing or malformed value stops
// the Worker. Every rule (a model, a threshold, a price, a timeout, which provider does what) is a constant in the
// module that owns it, so changing one is a commit, never a variable.

const deploymentConfig = Config.all({
  environment: Config.schema(Environment, 'STYLD_ENV'),
  release: Config.String('STYLD_RELEASE'),
  origin: Config.schema(Schema.NonEmptyString, 'AUTH_ORIGIN'),
  authSecret: Config.String('AUTH_SECRET'),
  sessionKeys: Config.String('AUTH_SESSION_KEYS'),
  proofKeys: Config.String('AUTH_PROOF_KEYS'),
  requestBindingKeys: Config.String('AUTH_REQUEST_BINDING_KEYS'),
  /** Accounts whose assistants get the curation tools: their sign-in emails, comma-separated. */
  adminEmails: Config.String('STYLD_ADMIN_EMAILS').pipe(Config.withDefault('')),
  /** Meta's key, for SAM and Muse Image. */
  metaApiKey: Config.Redacted('META_API_KEY'),
  /** The Vercel AI Gateway's key, for Veo. */
  videoGatewayKey: Config.Redacted('VIDEO_GATEWAY_API_KEY'),
})

/** The deployment, from the Worker's bindings. */
export const deploymentOf = Effect.fn('Styld.Config.deployment')(function* (env: Readonly<Record<string, unknown>>) {
  const raw = yield* deploymentConfig.parse(ConfigProvider.fromUnknown(env)).pipe(Effect.orDie)
  return {
    environment: raw.environment,
    release: raw.release,
    origin: raw.origin,
    admins: adminEmails(raw.adminEmails),
    auth: {
      origin: raw.origin,
      secret: yield* decodeAuthSecret(raw.authSecret).pipe(Effect.orDie),
      sessionKeys: yield* decodeAuthSessionKeyring(raw.sessionKeys).pipe(Effect.orDie),
      proofKeys: yield* decodeProofKeyring(raw.proofKeys).pipe(Effect.orDie),
      requestBindingKeys: yield* decodeRequestBindingKeyring(raw.requestBindingKeys).pipe(Effect.orDie),
    },
    secrets: { metaApiKey: raw.metaApiKey, videoGatewayKey: raw.videoGatewayKey },
  }
})

export type Deployment = Effect.Success<ReturnType<typeof deploymentOf>>
