import { Environment } from '@styld/observability'
import type { StylistThreadsApi } from './stylist/Agent.ts'
import { Config, ConfigProvider, Context, Data, Effect, Option, Predicate, Redacted, Schema } from 'effect'
import { webhookKeyOf } from './billing/Signature.ts'
import { operatorDigestOf } from './Operator.ts'
import {
  decodeAuthSecret,
  decodeAuthSessionKeyring,
  decodeOAuthKeyring,
  decodeProofKeyring,
  decodeRequestBindingKeyring,
} from './AuthConfiguration.ts'
import { emailListOf } from './social/Curation.ts'

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
  /** The house accounts the operator's seed may write boards into: their sign-in emails, comma-separated. */
  houseEmails: Config.String('STYLD_HOUSE_EMAILS').pipe(Config.withDefault('')),
  /** Meta's key, for SAM and Muse Image. */
  metaApiKey: Config.Redacted('META_API_KEY'),
  /** The Vercel AI Gateway's key, for Veo. */
  videoGatewayKey: Config.Redacted('VIDEO_GATEWAY_API_KEY'),
  /** Styld's own paid text route; the key is restricted to its model and budget in LiteLLM. */
  textBase: Config.schema(Schema.NonEmptyString, 'STYLD_LITELLM_URL'),
  textKey: Config.Redacted('STYLD_LITELLM_KEY'),
  /** Sign in with Google (v1's OAuth client) and the keys that seal each sign-in in progress; Google is offered only
   * when all three are set. */
  googleClientId: Config.String('GOOGLE_CLIENT_ID').pipe(Config.option),
  googleClientSecret: Config.Redacted('GOOGLE_CLIENT_SECRET').pipe(Config.option),
  oauthKeys: Config.String('AUTH_OAUTH_KEYS').pipe(Config.option),
  /** The operator's token (`Operator.ts`); none switches the operator's routes off. */
  operatorToken: Config.Redacted('STYLD_OPERATOR_TOKEN').pipe(Config.option),
  /** Dodo Payments (`billing/`): its API's address and each plan's product, from the stage's facts, and the API key
   * and webhook secret; payments are on only when all of them are set. */
  dodoBase: Config.String('STYLD_DODO_BASE').pipe(Config.option),
  dodoProducts: Config.all({
    week: Config.String('STYLD_DODO_PRODUCT_WEEK'),
    monthly: Config.String('STYLD_DODO_PRODUCT_MONTHLY'),
    yearly: Config.String('STYLD_DODO_PRODUCT_YEARLY'),
    lifetime: Config.String('STYLD_DODO_PRODUCT_LIFETIME'),
  }).pipe(Config.option),
  dodoKey: Config.Redacted('STYLD_DODO_API_KEY').pipe(Config.option),
  dodoWebhookSecret: Config.Redacted('STYLD_DODO_WEBHOOK_SECRET').pipe(Config.option),
})

/** `STYLD_DODO_WEBHOOK_SECRET` is not a `whsec_<base64>` secret: a broken stage, so the Worker does not start. */
class WebhookSecretMalformed extends Data.TaggedError('WebhookSecretMalformed') {}

/** Payments, when the stage has all of Dodo's settings: the API's address, each plan's product, the key and the
 * webhook's HMAC key. */
const billingOf = (raw: Config.Success<typeof deploymentConfig>) =>
  Option.match(
    Option.all({ base: raw.dodoBase, products: raw.dodoProducts, key: raw.dodoKey, secret: raw.dodoWebhookSecret }),
    {
      onNone: () => Effect.succeed(Option.none()),
      onSome: ({ base, products, key, secret }) =>
        Option.match(webhookKeyOf(Redacted.value(secret)), {
          onNone: () => Effect.die(new WebhookSecretMalformed()),
          onSome: (webhookKey) =>
            Effect.succeed(Option.some({ base: base.replace(/\/$/u, ''), products, key, webhookKey })),
        }),
    },
  )

/** The deployment, from the Worker's bindings. */
export const deploymentOf = Effect.fn('Styld.Config.deployment')(function* (env: Readonly<Record<string, unknown>>) {
  const raw = yield* deploymentConfig.parse(ConfigProvider.fromUnknown(env)).pipe(Effect.orDie)
  return {
    environment: raw.environment,
    release: raw.release,
    origin: raw.origin,
    admins: emailListOf(raw.adminEmails),
    house: emailListOf(raw.houseEmails),
    auth: {
      origin: raw.origin,
      secret: yield* decodeAuthSecret(raw.authSecret).pipe(Effect.orDie),
      sessionKeys: yield* decodeAuthSessionKeyring(raw.sessionKeys).pipe(Effect.orDie),
      proofKeys: yield* decodeProofKeyring(raw.proofKeys).pipe(Effect.orDie),
      requestBindingKeys: yield* decodeRequestBindingKeyring(raw.requestBindingKeys).pipe(Effect.orDie),
      ...(Option.isSome(raw.googleClientId) && Option.isSome(raw.googleClientSecret) && Option.isSome(raw.oauthKeys)
        ? {
            google: {
              client: { clientId: raw.googleClientId.value, clientSecret: raw.googleClientSecret.value },
              transactionKeys: yield* decodeOAuthKeyring(raw.oauthKeys.value).pipe(Effect.orDie),
            },
          }
        : {}),
    },
    textBase: raw.textBase.replace(/\/$/u, ''),
    // Only the token's digest is kept; a token too short to be a random secret stops the Worker.
    operator: Option.isNone(raw.operatorToken)
      ? Option.none<Uint8Array>()
      : Option.some(yield* operatorDigestOf(Redacted.value(raw.operatorToken.value)).pipe(Effect.orDie)),
    secrets: { metaApiKey: raw.metaApiKey, videoGatewayKey: raw.videoGatewayKey, textKey: raw.textKey },
    billing: yield* billingOf(raw),
  }
})

const threadWorkerConfig = Config.all({
  environment: Config.schema(Environment, 'STYLD_ENV'),
  release: Config.String('STYLD_RELEASE'),
  /** Meta's key, the one SAM and Muse Image use, for the chat's Muse Spark calls. */
  metaApiKey: Config.Redacted('META_API_KEY'),
})

/** What the Thread Worker (`stylist/ThreadWorker.ts`) is told about its deployment: its stage and release, for its
 * logs, spans and call counts, and Meta's key for Styld's model. The one decoder of its bindings; a missing or
 * malformed value is a broken deployment. */
export const threadDeploymentOf = Effect.fn('Styld.Config.threadDeployment')(function* (env: unknown) {
  return yield* threadWorkerConfig.parse(ConfigProvider.fromUnknown(env)).pipe(Effect.orDie)
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
