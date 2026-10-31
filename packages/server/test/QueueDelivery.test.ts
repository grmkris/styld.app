import { Effect, References, Tracer } from 'effect'
import { expect, test } from 'vitest'
import { asDelivery, type Queue } from '../src/QueueDelivery.ts'

const base = { environment: 'preview', release: 'cb10b19', component: 'server' } as const

/** The span and log fields one delivery runs under. */
const labelsOf = async (queue: Queue, body: unknown) => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  const message = { id: 'm-7', timestamp: new Date(0), body, attempts: 2, ack: () => undefined, retry: () => undefined }
  const logs = await Effect.runPromise(
    Effect.service(References.CurrentLogAnnotations).pipe(
      asDelivery(base, queue, message),
      Effect.provideService(Tracer.Tracer, tracer),
    ),
  )
  return { name: spans[0]?.name, span: Object.fromEntries(spans[0]?.attributes ?? []), logs }
}

test('a delivery runs under its queue, the job it carries and its attempt, on its span and its logs', async () => {
  const generation = await labelsOf('generation', { jobId: `gj_${'a'.repeat(22)}` })
  expect(generation.name).toBe('styld.queue')
  expect(generation.span).toEqual({
    'styld.environment': 'preview',
    'styld.release': 'cb10b19',
    'styld.component': 'server',
    'styld.kind': 'queue.generation',
    'styld.job_id': `gj_${'a'.repeat(22)}`,
    'styld.attempt': 2,
  })
  expect(generation.logs).toEqual(generation.span)
  expect((await labelsOf('stylist', { stylistTurnOf: 'tn_1', accountId: 'acc' })).span['styld.job_id']).toBe('tn_1')
  expect(
    (await labelsOf('checks', { _tag: 'CheckContent', target: { kind: 'board', id: 'bd_1' } })).span,
  ).toMatchObject({ 'styld.kind': 'queue.checks', 'styld.job_id': 'board:bd_1' })
  // A piece's work, or a body that is not the queue's, keeps the queue's own message id; never the account.
  expect((await labelsOf('pieces', { pieceId: 'pc_1' })).span['styld.job_id']).toBe('m-7')
  expect((await labelsOf('generation', { other: true })).span['styld.job_id']).toBe('m-7')
  expect(JSON.stringify((await labelsOf('stylist', { stylistTurnOf: 'tn_1', accountId: 'acc' })).span)).not.toContain(
    'acc',
  )
})
