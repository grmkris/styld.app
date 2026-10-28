import { TraceId } from '@styld/observability'
import { Effect, Layer, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

/** The browser SDK posts OTLP/JSON to `${origin}/api/telemetry` with a declared length;
 * bodies above this, or without a length, are refused unread. */
export const maxBodyBytes = 256 * 1024
/** At most this many spans of one request are recorded; the rest are dropped and counted. */
export const maxSpansPerRequest = 200
const maxText = 256
const maxStack = 2048

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
  status: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.Int) })),
})
/** The subset of an OTLP/JSON trace export that is read; every other field is ignored. */
export const TraceExport = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({ scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(Span) })) }),
  ),
})
export type TraceExport = typeof TraceExport.Type

/** Browser span attributes worth keeping, with their maximum text length. Everything
 * else (full URLs with queries, user agent, session and visitor IDs, locale, time
 * zone, Command arguments) never leaves the request. */
const allowed: Readonly<Record<string, number>> = {
  'maple.foldkit.message': maxText,
  'maple.foldkit.navigation_id': maxText,
  'maple.foldkit.phase': maxText,
  'maple.foldkit.duration_ms': maxText,
  'maple.foldkit.threshold_ms': maxText,
  'maple.foldkit.recent_messages': maxText,
  'maple.navigation.interrupted': maxText,
  'maple.interrupted': maxText,
  'maple.exception.source': maxText,
  'http.request.method': maxText,
  'http.response.status_code': maxText,
  'url.path': maxText,
  'error.type': maxText,
  'exception.type': maxText,
  'exception.message': maxText,
  'exception.stacktrace': maxStack,
  'browser.uncaught_error': maxText,
  'browser.unhandled_rejection': maxText,
  'foldkit.crash': maxText,
}

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

const durationMs = (start: string | number, end: string | number): number =>
  Math.max(0, Number((BigInt(end) - BigInt(start)) / 1_000_000n))

const spansOf = (payload: TraceExport) =>
  payload.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))

/** One bounded, allowlisted log record per browser span, capped per request. */
export const browserSpanRecords = (payload: TraceExport): ReadonlyArray<BrowserSpanRecord> =>
  spansOf(payload)
    .slice(0, maxSpansPerRequest)
    .map((span) => {
      const record: Record<string, Field> = {
        'styld.browser.trace_id': span.traceId,
        'styld.browser.span_id': span.spanId,
        'styld.browser.span': safeName(span.name),
        'styld.browser.duration_ms': durationMs(span.startTimeUnixNano, span.endTimeUnixNano),
        'styld.browser.outcome': span.status?.code === 2 ? 'error' : 'ok',
      }
      const parent = Option.getOrUndefined(Schema.decodeUnknownOption(SpanId)(span.parentSpanId))
      if (parent !== undefined) record['styld.browser.parent_span_id'] = parent
      for (const attribute of span.attributes ?? []) {
        const limit = allowed[attribute.key]
        if (limit === undefined) continue
        const value = fieldValue(attribute.value, limit)
        if (value !== undefined) record[`styld.browser.${attribute.key}`] = value
      }
      return record
    })

const respond = (status: number) => HttpServerResponse.empty({ status })

/** Admission shared by every signal: same-origin JSON within the size budget. */
const admit = (origin: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    if (request.headers['origin'] !== origin) return Option.some(respond(403))
    if (!request.headers['content-type']?.startsWith('application/json')) return Option.some(respond(415))
    const length = request.headers['content-length']
    if (length === undefined || !/^\d+$/.test(length)) return Option.some(respond(411))
    if (Number(length) > maxBodyBytes) return Option.some(respond(413))
    return Option.none()
  })

const recordTraces = (origin: string) =>
  Effect.gen(function* () {
    const refused = yield* admit(origin)
    if (Option.isSome(refused)) return refused.value
    const request = yield* HttpServerRequest
    // workerd never delivers more than the declared, already bounded length.
    const body = yield* Effect.option(request.json)
    if (Option.isNone(body)) return respond(400)
    const payload = Schema.decodeUnknownOption(TraceExport)(body.value)
    if (Option.isNone(payload)) return respond(400)
    yield* Effect.forEach(
      browserSpanRecords(payload.value),
      (record) => Effect.logInfo('styld.browser.span').pipe(Effect.annotateLogs(record)),
      { discard: true },
    )
    const dropped = spansOf(payload.value).length - maxSpansPerRequest
    if (dropped > 0) yield* Effect.logWarning('styld.browser.spans_dropped').pipe(Effect.annotateLogs({ dropped }))
    return respond(204)
  }).pipe(Effect.withSpan('Styld.BrowserTelemetry.traces'))

/** Logs and metrics are acknowledged and discarded: browser failures already arrive as spans. */
const discard = (origin: string) =>
  Effect.map(
    admit(origin),
    Option.getOrElse(() => respond(204)),
  )

/** Same-origin OTLP/JSON relay for browser telemetry into Workers Logs. */
export const browserTelemetryRoutes = (origin: string) =>
  Layer.mergeAll(
    HttpRouter.add('POST', '/api/telemetry/v1/traces', recordTraces(origin)),
    HttpRouter.add('POST', '/api/telemetry/v1/logs', discard(origin)),
    HttpRouter.add('POST', '/api/telemetry/v1/metrics', discard(origin)),
  )
