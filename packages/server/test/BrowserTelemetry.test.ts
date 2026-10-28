import { Effect, Layer, Logger, Option, References } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import { afterAll, expect, test } from 'vitest'
import {
  browserSpanRecords,
  browserTelemetryRoutes,
  decodeTraceExport,
  maxSpansPerRequest,
} from '../src/BrowserTelemetry.ts'

const origin = 'https://styld.test'
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
type Logged = { readonly message: unknown; readonly annotations: Readonly<Record<string, unknown>> }
const logged: Array<Logged> = []
const capture = Logger.make((options) => {
  logged.push({ message: options.message, annotations: options.fiber.getRef(References.CurrentLogAnnotations) })
})
const clients: Array<string> = []
let allowance = true
const allow = (client: string) =>
  Effect.sync(() => {
    clients.push(client)
    return allowance
  })
const app = HttpRouter.toWebHandler(
  browserTelemetryRoutes(origin, allow).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(Logger.layer([capture])),
  ),
  { disableLogger: true },
)
afterAll(() => app.dispose())

const span = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  traceId,
  spanId: '00f067aa0ba902b7',
  parentSpanId: '',
  name: 'SaveLocale',
  startTimeUnixNano: '1000000000',
  endTimeUnixNano: '1250000000',
  status: { code: 1 },
  attributes: [
    { key: 'maple.foldkit.message', value: { stringValue: 'SucceededSaveLocale' } },
    { key: 'http.response.status_code', value: { intValue: '204' } },
    { key: 'url.full', value: { stringValue: 'https://styld.test/locale?token=secret' } },
    { key: 'url.path', value: { stringValue: '/@private-person/looks' } },
    { key: 'user_agent.original', value: { stringValue: 'Mozilla/5.0 private' } },
    { key: 'session.id', value: { stringValue: 'session-secret' } },
    { key: 'maple.foldkit.arg.email', value: { stringValue: 'person@example.com' } },
    { key: 'constructor', value: { doubleValue: 3.14 } },
    { key: '__proto__', value: { stringValue: 'polluted' } },
  ],
  ...overrides,
})
const payload = (spans: ReadonlyArray<unknown>) => ({ resourceSpans: [{ scopeSpans: [{ spans }] }] })
const decoded = (spans: ReadonlyArray<unknown>) => Option.getOrThrow(decodeTraceExport(payload(spans))).spans

const post = (path: string, body: string, headers: Readonly<Record<string, string>> = {}, type = 'application/json') =>
  app.handler(
    new Request(`${origin}/api/telemetry/v1/${path}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': type,
        'content-length': String(new TextEncoder().encode(body).length),
        'cf-connecting-ip': '203.0.113.7',
        ...headers,
      },
      body,
    }),
  )

test('records one bounded, allowlisted log per browser span', async () => {
  logged.length = 0
  const response = await post('traces', JSON.stringify(payload([span()])))
  expect(response.status).toBe(204)
  expect(logged).toHaveLength(1)
  const fields = logged[0]?.annotations ?? {}
  expect(fields).toMatchObject({
    'styld.browser.trace_id': traceId,
    'styld.browser.span_id': '00f067aa0ba902b7',
    'styld.browser.span': 'SaveLocale',
    'styld.browser.duration_ms': 250,
    'styld.browser.outcome': 'ok',
    'styld.browser.maple.foldkit.message': 'SucceededSaveLocale',
    'styld.browser.http.response.status_code': 204,
  })
  const serialized = JSON.stringify(fields)
  for (const secret of ['token=secret', '@private-person', 'Mozilla', 'session-secret', 'person@example.com'])
    expect(serialized).not.toContain(secret)
  // Inherited object keys never pass the allowlist.
  expect(Object.keys(fields).filter((key) => /constructor|__proto__/.test(key))).toEqual([])
  expect(fields).not.toHaveProperty('styld.browser.parent_span_id')
})

test('keeps bounded exception details from exception span events', async () => {
  logged.length = 0
  const crash = span({
    name: 'foldkit.crash',
    status: { code: 2 },
    events: [
      {
        name: 'exception',
        attributes: [
          { key: 'exception.type', value: { stringValue: 'TypeError' } },
          { key: 'exception.message', value: { stringValue: 'x'.repeat(1000) } },
          { key: 'exception.stacktrace', value: { stringValue: 'at view (View.ts:1)\n'.repeat(500) } },
        ],
      },
      { name: 'click', attributes: [{ key: 'exception.message', value: { stringValue: 'not an exception event' } }] },
    ],
  })
  expect((await post('traces', JSON.stringify(payload([crash])))).status).toBe(204)
  const fields = logged[0]?.annotations ?? {}
  expect(fields).toMatchObject({ 'styld.browser.outcome': 'error', 'styld.browser.exception.type': 'TypeError' })
  expect(String(fields['styld.browser.exception.message'])).toHaveLength(256)
  expect(String(fields['styld.browser.exception.stacktrace'])).toHaveLength(2048)
})

test('skips invalid spans and counts them instead of rejecting the batch', async () => {
  logged.length = 0
  const response = await post('traces', JSON.stringify(payload([span(), span({ traceId: '0'.repeat(32) }), 'junk'])))
  expect(response.status).toBe(204)
  expect(logged.map(({ message }) => message)).toEqual([['styld.browser.span'], ['styld.browser.spans_dropped']])
  expect(logged[1]?.annotations).toMatchObject({ dropped: 0, invalid: 2 })
})

test('refuses foreign, untyped, unbounded, throttled or malformed exports without logging', async () => {
  logged.length = 0
  const body = JSON.stringify(payload([span()]))
  expect((await post('traces', body, { origin: 'https://evil.test' })).status).toBe(403)
  expect((await post('traces', body, { 'content-type': 'text/plain' })).status).toBe(415)
  expect((await post('traces', body, { 'content-length': 'many' })).status).toBe(411)
  expect((await post('traces', body, { 'content-length': String(2 * 1024 * 1024) })).status).toBe(413)
  expect((await post('traces', JSON.stringify({ resourceSpans: 'nope' }))).status).toBe(400)
  allowance = false
  clients.length = 0
  expect((await post('traces', body)).status).toBe(429)
  expect((await post('sessionEvents', '{}\n', {}, 'application/x-ndjson')).status).toBe(429)
  allowance = true
  expect(clients).toEqual(['203.0.113.7', '203.0.113.7'])
  expect(logged).toEqual([])
})

test('acknowledges and discards browser logs, metrics and session events', async () => {
  logged.length = 0
  expect((await post('logs', '{"resourceLogs":[]}')).status).toBe(204)
  expect((await post('metrics', '{"resourceMetrics":[]}')).status).toBe(204)
  expect((await post('sessionEvents', '{"type":"click"}\n', {}, 'application/x-ndjson')).status).toBe(204)
  expect((await post('metrics', '{}', { origin: 'https://evil.test' })).status).toBe(403)
  expect(logged).toEqual([])
})

test('caps records per request and keeps valid parents', () => {
  const many = Array.from({ length: maxSpansPerRequest + 5 }, () => span())
  expect(browserSpanRecords(decoded(many))).toHaveLength(maxSpansPerRequest)
  const [record] = browserSpanRecords(
    decoded([span({ name: 'pageload <script>/login', parentSpanId: '1111111111111111' })]),
  )
  expect(record).toMatchObject({
    'styld.browser.span': 'pageload _script_/login',
    'styld.browser.parent_span_id': '1111111111111111',
  })
})
