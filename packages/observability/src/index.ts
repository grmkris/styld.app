import { Effect, Option, Schema } from 'effect'

/** Values that can safely identify a deployment without exposing a request payload. */
export const Environment = Schema.Literals(['local', 'preview', 'production'])
export type Environment = typeof Environment.Type

const SafeText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9._:/-]+$/),
)
const Attempt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000))

/** The only metadata accepted by the application telemetry seam. */
export const ObservabilityMetadata = Schema.Struct({
  environment: Environment,
  release: SafeText,
  component: SafeText,
  kind: Schema.optional(SafeText),
  correlationId: Schema.optional(SafeText),
  operationId: Schema.optional(SafeText),
  jobId: Schema.optional(SafeText),
  attempt: Schema.optional(Attempt),
})
export type ObservabilityMetadata = typeof ObservabilityMetadata.Type

export type ObservabilityBase = Pick<ObservabilityMetadata, 'environment' | 'release' | 'component'>

export const makeObservabilityBase = (input: {
  readonly environment: unknown
  readonly release: unknown
  readonly component: unknown
}): ObservabilityBase => ({
  environment: Option.getOrElse(Schema.decodeUnknownOption(Environment)(input.environment), () => 'local'),
  release: safeText(input.release) ?? 'unreleased',
  component: safeText(input.component) ?? 'unknown',
})

type FetchHeaders = { readonly get: (name: string) => string | null }
type EffectHeaders = { readonly get?: undefined; readonly [key: string]: string | undefined }
type HeaderSource = EffectHeaders | FetchHeaders

const readHeader = (headers: HeaderSource, name: string): string | undefined => {
  const value = (typeof headers.get === 'function' ? headers.get(name) : headers[name])?.trim()
  return value === undefined || value === '' ? undefined : value
}

const safeText = (value: unknown): string | undefined => {
  const result = Schema.decodeUnknownOption(SafeText)(value)
  return Option.getOrUndefined(result)
}

const safeAttempt = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !/^[0-9]{1,4}$/.test(value)) return undefined
  const parsed = Number(value)
  return Schema.is(Attempt)(parsed) ? parsed : undefined
}

/**
 * Reads only the bounded correlation headers owned by Styld. Arbitrary headers,
 * bodies and query parameters never enter spans or logs.
 */
export const metadataFromHeaders = (base: ObservabilityBase, headers: HeaderSource): ObservabilityMetadata => {
  const candidate = {
    ...base,
    kind: safeText(readHeader(headers, 'x-styld-kind')),
    correlationId: safeText(readHeader(headers, 'x-styld-correlation-id')),
    operationId: safeText(readHeader(headers, 'x-styld-operation-id')),
    jobId: safeText(readHeader(headers, 'x-styld-job-id')),
    attempt: safeAttempt(readHeader(headers, 'x-styld-attempt')),
  }
  return Schema.decodeUnknownOption(ObservabilityMetadata)(candidate).pipe(Option.getOrElse(() => ({ ...base })))
}

/** Convert the typed metadata to a record with no undefined optional fields. */
export const metadataAttributes = (metadata: ObservabilityMetadata): Record<string, string | number> => {
  const attributes: Record<string, string | number> = {
    'styld.environment': metadata.environment,
    'styld.release': metadata.release,
    'styld.component': metadata.component,
  }
  if (metadata.kind !== undefined) attributes['styld.kind'] = metadata.kind
  if (metadata.correlationId !== undefined) attributes['styld.correlation_id'] = metadata.correlationId
  if (metadata.operationId !== undefined) attributes['styld.operation_id'] = metadata.operationId
  if (metadata.jobId !== undefined) attributes['styld.job_id'] = metadata.jobId
  if (metadata.attempt !== undefined) attributes['styld.attempt'] = metadata.attempt
  return attributes
}

/**
 * Add one named Effect span and the same bounded fields to every log emitted by
 * the effect. Callers cannot pass arbitrary attributes through this API.
 */
export const withObservability =
  (name: string, metadata: ObservabilityMetadata) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.annotateLogs(
      Effect.withSpan(effect, name, { attributes: metadataAttributes(metadata), captureStackTrace: false }),
      metadataAttributes(metadata),
    )
