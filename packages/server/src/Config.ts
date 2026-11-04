import { Environment } from '@styld/observability'
import type { StylistThreadsApi } from './stylist/Agent.ts'
import { Config, ConfigProvider, Context, Effect, Option, Predicate, Redacted, Schema } from 'effect'
import { operatorDigestOf } from './Operator.ts'
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
  /** Styld's own paid text route; the key is restricted to its model and budget in LiteLLM. */
  textBase: Config.schema(Schema.NonEmptyString, 'STYLD_LITELLM_URL'),
  textKey: Config.Redacted('STYLD_LITELLM_KEY'),
  /** The operator's token (`Operator.ts`); none switches the operator's routes off. */
  operatorToken: Config.Redacted('STYLD_OPERATOR_TOKEN').pipe(Config.option),
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
    textBase: raw.textBase.replace(/\/$/u, ''),
    // Only the token's digest is kept; a token too short to be a random secret stops the Worker.
    operator: Option.isNone(raw.operatorToken)
      ? Option.none<Uint8Array>()
      : Option.some(yield* operatorDigestOf(Redacted.value(raw.operatorToken.value)).pipe(Effect.orDie)),
    secrets: { metaApiKey: raw.metaApiKey, videoGatewayKey: raw.videoGatewayKey, textKey: raw.textKey },
  }
})

/** The deployment, decoded once per runtime, for the modules that need its origin, release, admins or keys. */
export class Deployment extends Context.Service<Deployment, Effect.Success<ReturnType<typeof deploymentOf>>>()(
  '@styld/server/Deployment',
) {}

/** A service binding with RPC, as far as the Worker can tell: something it can call. */
const isThreadWorker = (value: unknown): value is StylistThreadsApi =>
  Predicate.hasProperty(value, 'admit') && Predicate.isFunction(value.admit)

/** The Thread Worker's entrypoint (`stylist/Thread.ts`), which the stack binds to the API Worker as
 * `STYLIST_THREADS` (`alchemy.run.ts`). A Worker without it is a broken deployment. */
export const stylistThreadsOf = (env: Readonly<Record<string, unknown>>) =>
  isThreadWorker(env.STYLIST_THREADS)
    ? Effect.succeed(env.STYLIST_THREADS)
    : Effect.die(new Error('STYLIST_THREADS is not bound to the API Worker'))
