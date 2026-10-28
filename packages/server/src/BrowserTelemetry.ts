import { TraceId } from '@styld/observability'
import { Effect, Layer, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

/** The browser SDK posts to `${origin}/api/telemetry` with a declared length; bodies above
 * this, or without a length, are refused unread. Large enough for a buffer that built up
 * while the relay was unreachable, so the client can drain it instead of retrying forever. */
export const maxBodyBytes = 1024 * 1024
/** At most this many spans of one request are logged; the rest and invalid spans are counted. */
export const maxSpansPerRequest = 100
const maxText = 256
const maxStack = 2048

/** Whether a client (by IP) may post telemetry now; the Worker backs it with a rate limit. */
export type TelemetryAllowance<R> = (client: string) => Effect.Effect<boolean, never, R>

const SpanId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/))
const Nanos = Schema.Union([Schema.String.check(Schema.isPattern(/^\d{1,20}$/)), Schema.Int])
const AnyValue = Schema.Struct({
  stringValue: Schema.optional(Schema.String),
  boolValue: Schema.optional(Schema.Boolean),
  intValue: Schema.optional(Nanos),
  doubleValue: Schema.optional(Schema.Number),
})
const KeyValue = Schema.Struct({ key: Schema.String, value: AnyValue })
const Span = Schema.Struct({
  traceId: TraceId,
  spanId: SpanId,
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.String,
  startTimeUnixNano: Nanos,
  endTimeUnixNano: Nanos,
  attributes: Schema.optional(Schema.Array(KeyValue)),
  events: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, attributes: Schema.optional(Schema.Array(KeyValue)) })),
  ),
  status: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.Int) })),
})
export type BrowserSpan = typeof Span.Type
/** The OTLP/JSON envelope; spans are decoded one by one so an invalid span cannot sink a batch. */
const TraceEnvelope = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({ scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(Schema.Unknown) })) }),
  ),
})

/** Spans of a trace export, skipping (and counting) invalid ones; `None` for a malformed envelope. */
export const decodeTraceExport = (
  body: unknown,
): Option.Option<{ readonly spans: ReadonlyArray<BrowserSpan>; readonly invalid: number }> =>
  Option.map(Schema.decodeUnknownOption(TraceEnvelope)(body), (envelope) => {
    const raw = envelope.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))
    const spans = raw.flatMap((span) => Option.toArray(Schema.decodeUnknownOption(Span)(span)))
    return { spans, invalid: raw.length - spans.length }
  })

/** Browser span fields worth keeping, with their maximum text length. Everything else (URL
 * paths and full URLs, user agent, session and visitor IDs, locale, time zone, Command
 * arguments) never leaves the request; span names carry fixed routes. A Map, so inherited
 * object keys such as `constructor` can never match. */
const allowed: ReadonlyMap<string, number> = new Map([
  ['maple.foldkit.message', maxText],
  ['maple.foldkit.phase', maxText],
  ['maple.foldkit.duration_ms', maxText],
  ['maple.foldkit.threshold_ms', maxText],
  ['maple.navigation.interrupted', maxText],
  ['maple.interrupted', maxText],
  ['maple.exception.source', maxText],
  ['http.request.method', maxText],
  ['http.response.status_code', maxText],
  ['error.type', maxText],
  // Crash and uncaught-error details arrive on `exception` span events.
  ['exception.type', maxText],
  ['exception.message', maxText],
  ['exception.stacktrace', maxStack],
])

type Field = string | number | boolean
export type BrowserSpanRecord = Readonly<Record<string, Field>>

const safeName = (name: string): string => name.replaceAll(/[^\w .:/@-]/g, '_').slice(0, 128)

const fieldValue = (value: typeof AnyValue.Type, limit: number): Field | undefined => {
  if (value.stringValue !== undefined) return value.stringValue.slice(0, limit)
  if (value.boolValue !== undefined) return value.boolValue
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.intValue !== undefined) return Number(value.intValue)
  return undefined
}

const copyAllowed = (record: Record<string, Field>, attributes: ReadonlyArray<typeof KeyValue.Type> = []) => {
  for (const attribute of attributes) {
    const limit = allowed.get(attribute.key)
    if (limit === undefined) continue
    const value = fieldValue(attribute.value, limit)
    if (value !== undefined) record[`styld.browser.${attribute.key}`] = value
  }
}

const durationMs = (start: string | number, end: string | number): number =>
  Math.max(0, Number((BigInt(end) - BigInt(start)) / 1_000_000n))

/** One bounded, allowlisted log record per browser span, capped per request. */
export const browserSpanRecords = (spans: ReadonlyArray<BrowserSpan>): ReadonlyArray<BrowserSpanRecord> =>
  spans.slice(0, maxSpansPerRequest).map((span) => {
    const record: Record<string, Field> = {
      'styld.browser.trace_id': span.traceId,
      'styld.browser.span_id': span.spanId,
      'styld.browser.span': safeName(span.name),
      'styld.browser.duration_ms': durationMs(span.startTimeUnixNano, span.endTimeUnixNano),
      'styld.browser.outcome': span.status?.code === 2 ? 'error' : 'ok',
    }
    const parent = Option.getOrUndefined(Schema.decodeUnknownOption(SpanId)(span.parentSpanId))
    if (parent !== undefined) record['styld.browser.parent_span_id'] = parent
    copyAllowed(record, span.attributes)
    for (const event of span.events ?? []) if (event.name === 'exception') copyAllowed(record, event.attributes)
    return record
  })

const respond = (status: number) => HttpServerResponse.empty({ status })

/** Admission for every signal, checked before the body is read: same origin, the expected
 * content type, a declared length within budget, and the client's rate allowance. */
const admit = <R>(origin: string, allow: TelemetryAllowance<R>, contentType: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    if (request.headers['origin'] !== origin) return Option.some(respond(403))
    if (!request.headers['content-type']?.startsWith(contentType)) return Option.some(respond(415))
    const length = request.headers['content-length']
    if (length === undefined || !/^\d+$/.test(length)) return Option.some(respond(411))
    if (Number(length) > maxBodyBytes) return Option.some(respond(413))
    if (!(yield* allow(request.headers['cf-connecting-ip'] ?? 'unknown'))) return Option.some(respond(429))
    return Option.none()
  })

const recordTraces = <R>(origin: string, allow: TelemetryAllowance<R>) =>
  Effect.gen(function* () {
    const refused = yield* admit(origin, allow, 'application/json')
    if (Option.isSome(refused)) return refused.value
    const request = yield* HttpServerRequest
    // workerd never delivers more than the declared, already bounded length.
    const decoded = Option.flatMap(yield* Effect.option(request.json), decodeTraceExport)
    if (Option.isNone(decoded)) return respond(400)
    const { spans, invalid } = decoded.value
    yield* Effect.forEach(
      browserSpanRecords(spans),
      (record) => Effect.logInfo('styld.browser.span').pipe(Effect.annotateLogs(record)),
      { discard: true },
    )
    const dropped = Math.max(0, spans.length - maxSpansPerRequest)
    if (dropped > 0 || invalid > 0) {
      yield* Effect.logWarning('styld.browser.spans_dropped').pipe(Effect.annotateLogs({ dropped, invalid }))
    }
    return respond(204)
  }).pipe(Effect.withSpan('Styld.BrowserTelemetry.traces'))

/** Acknowledged and discarded: browser logs and metrics (failures already arrive as spans)
 * and the SDK's session events, which it always sends and nothing here stores. */
const discard = <R>(origin: string, allow: TelemetryAllowance<R>, contentType: string) =>
  Effect.map(
    admit(origin, allow, contentType),
    Option.getOrElse(() => respond(204)),
  )

/** Same-origin, rate-limited OTLP/JSON relay for browser telemetry into Workers Logs. */
export const browserTelemetryRoutes = <R>(origin: string, allow: TelemetryAllowance<R>) =>
  Layer.mergeAll(
    HttpRouter.add('POST', '/api/telemetry/v1/traces', recordTraces(origin, allow)),
    HttpRouter.add('POST', '/api/telemetry/v1/logs', discard(origin, allow, 'application/json')),
    HttpRouter.add('POST', '/api/telemetry/v1/metrics', discard(origin, allow, 'application/json')),
    HttpRouter.add('POST', '/api/telemetry/v1/sessionEvents', discard(origin, allow, 'application/x-ndjson')),
  )
