import { Layer, Logger, References, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import { afterAll, expect, test } from 'vitest'
import { browserSpanRecords, browserTelemetryRoutes, maxSpansPerRequest, TraceExport } from '../src/BrowserTelemetry.ts'

const origin = 'https://styld.test'
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
type Logged = { readonly message: unknown; readonly annotations: Readonly<Record<string, unknown>> }
const logged: Array<Logged> = []
const capture = Logger.make((options) => {
  logged.push({ message: options.message, annotations: options.fiber.getRef(References.CurrentLogAnnotations) })
})
const app = HttpRouter.toWebHandler(
  browserTelemetryRoutes(origin).pipe(
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
    { key: 'exception.message', value: { stringValue: 'x'.repeat(1000) } },
  ],
  ...overrides,
})
const payload = (spans: ReadonlyArray<unknown>) => ({ resourceSpans: [{ scopeSpans: [{ spans }] }] })
const decoded = (spans: ReadonlyArray<unknown>) => Schema.decodeUnknownSync(TraceExport)(payload(spans))

const post = (path: string, body: string, headers: Readonly<Record<string, string>> = {}) =>
  app.handler(
    new Request(`${origin}/api/telemetry/v1/${path}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(body).length),
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
  expect(String(fields['styld.browser.exception.message'])).toHaveLength(256)
  const serialized = JSON.stringify(fields)
  for (const secret of ['token=secret', '@private-person', 'Mozilla', 'session-secret', 'person@example.com'])
    expect(serialized).not.toContain(secret)
  expect(fields).not.toHaveProperty('styld.browser.parent_span_id')
})

test('refuses foreign, untyped, unbounded or malformed exports without logging', async () => {
  logged.length = 0
  const body = JSON.stringify(payload([span()]))
  expect((await post('traces', body, { origin: 'https://evil.test' })).status).toBe(403)
  expect((await post('traces', body, { 'content-type': 'text/plain' })).status).toBe(415)
  expect((await post('traces', body, { 'content-length': 'many' })).status).toBe(411)
  expect((await post('traces', body, { 'content-length': String(300 * 1024) })).status).toBe(413)
  expect((await post('traces', JSON.stringify({ resourceSpans: 'nope' }))).status).toBe(400)
  expect((await post('traces', JSON.stringify(payload([span({ traceId: '0'.repeat(32) })])))).status).toBe(400)
  expect(logged).toEqual([])
})

test('acknowledges and discards browser logs and metrics', async () => {
  logged.length = 0
  expect((await post('logs', '{"resourceLogs":[]}')).status).toBe(204)
  expect((await post('metrics', '{"resourceMetrics":[]}')).status).toBe(204)
  expect((await post('metrics', '{}', { origin: 'https://evil.test' })).status).toBe(403)
  expect(logged).toEqual([])
})

test('caps records per request, keeps errors and valid parents, and sanitizes span names', () => {
  const many = Array.from({ length: maxSpansPerRequest + 5 }, () => span())
  expect(browserSpanRecords(decoded(many))).toHaveLength(maxSpansPerRequest)
  const [record] = browserSpanRecords(
    decoded([span({ name: 'pageload <script>/login', status: { code: 2 }, parentSpanId: '1111111111111111' })]),
  )
  expect(record).toMatchObject({
    'styld.browser.span': 'pageload _script_/login',
    'styld.browser.outcome': 'error',
    'styld.browser.parent_span_id': '1111111111111111',
  })
})
