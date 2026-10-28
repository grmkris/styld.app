import { Effect, Logger, References, Tracer } from 'effect'
import { expect, test } from 'vitest'
import { Environment, metadataAttributes, metadataFromHeaders, withObservability } from '../src/index.ts'

const base = { environment: 'preview' as const, release: 'release-123', component: 'server' }

test('accepts only bounded deployment and correlation metadata', () => {
  expect(Environment.literals).toEqual(['local', 'preview', 'production'])
  const metadata = metadataFromHeaders(
    base,
    new Headers({
      'x-styld-kind': 'http',
      'x-styld-correlation-id': 'corr-123',
      'x-styld-operation-id': 'op-123',
      'x-styld-job-id': 'job-123',
      'x-styld-attempt': '2',
      authorization: 'Bearer secret-token',
    }),
  )
  expect(metadata).toEqual({
    ...base,
    kind: 'http',
    correlationId: 'corr-123',
    operationId: 'op-123',
    jobId: 'job-123',
    attempt: 2,
  })
  expect(metadataAttributes(metadata)).not.toHaveProperty('authorization')
  expect(
    metadataFromHeaders(base, new Headers({ 'x-styld-correlation-id': 'prompt=ignore me', 'x-styld-attempt': '0' })),
  ).toEqual(base)
})

test('withObservability annotates logs and forwards the same approved span fields', async () => {
  const metadata = metadataFromHeaders(base, new Headers({ 'x-styld-correlation-id': 'corr-123' }))
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  const annotations: Array<Readonly<Record<string, unknown>>> = []
  const logger = Logger.make(() => undefined)

  await Effect.runPromise(
    Effect.gen(function* () {
      annotations.push(yield* Effect.service(References.CurrentLogAnnotations))
      yield* Effect.logInfo('safe')
      return yield* Effect.succeed('done')
    }).pipe(
      withObservability('styld.test', metadata),
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(Tracer.Tracer, tracer),
    ),
  )

  expect(spans).toHaveLength(1)
  expect(Object.fromEntries(spans[0]?.attributes ?? [])).toEqual(metadataAttributes(metadata))
  expect(annotations[0]).toEqual(metadataAttributes(metadata))
  expect(metadataFromHeaders(base, new Headers({ 'x-styld-job-id': 'x'.repeat(129) }))).toEqual(base)
})
