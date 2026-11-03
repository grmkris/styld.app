import { Effect, Option, Schema, Tracer } from 'effect'
import { describe, expect, test } from 'vitest'
import { consume, consumerSettings, defineQueue, type JobsOf } from '../src/jobs/Jobs.ts'
import { generationJobQueue } from '../src/generation/Queue.ts'
import { checkJobQueue } from '../src/safety/Queue.ts'
import { pieceJobQueue } from '../src/wardrobe/Queue.ts'

const base = { environment: 'preview', release: 'cb10b19', component: 'server' } as const

const Body = Schema.TaggedUnion({ Draw: { id: Schema.String }, Forget: { id: Schema.String } })
const queue = defineQueue({
  name: 'pieces',
  body: Body,
  attempts: 3,
  batchSize: 1,
  retryDelay: '1 seconds',
  jobOf: ({ id }) => Option.some(id),
})

/** Jobs that record what ran; `Draw` fails `failures` times, its give-up `giveUpFailures` times. */
const recording = (failures: number, giveUpFailures = 0) => {
  const ran: Array<string> = []
  let left = failures
  let giveUpLeft = giveUpFailures
  const jobs: JobsOf<typeof Body.Type> = {
    Draw: {
      run: ({ id }, attempt) =>
        Effect.suspend(() => {
          ran.push(`draw ${id} #${attempt}`)
          return left-- > 0 ? Effect.fail('busy') : Effect.void
        }),
      giveUp: ({ id }) =>
        Effect.suspend(() => {
          ran.push(`give up ${id}`)
          return giveUpLeft-- > 0 ? Effect.fail('down') : Effect.void
        }),
    },
    Forget: { run: () => Effect.void, giveUp: () => Effect.void },
  }
  return { ran, jobs }
}

/** A delivery that records how it was settled. */
const deliver = (jobs: JobsOf<typeof Body.Type>, body: unknown, attempts: number) => {
  const settled: Array<string> = []
  const message = {
    id: 'm-7',
    timestamp: new Date(0),
    body,
    attempts,
    ack: () => void settled.push('ack'),
    retry: () => void settled.push('retry'),
  }
  return Effect.as(consume(queue, base, jobs)(message), settled)
}

describe('a queue delivery', () => {
  test('is acknowledged once when its job ran', async () => {
    const { ran, jobs } = recording(0)
    expect(await Effect.runPromise(deliver(jobs, { _tag: 'Draw', id: 'a' }, 1))).toEqual(['ack'])
    expect(ran).toEqual(['draw a #1'])
  })

  test('is retried until its last attempt, which gives the job up', async () => {
    const { ran, jobs } = recording(9)
    const outcomes = await Effect.runPromise(
      Effect.forEach([1, 2, 3], (attempt) => deliver(jobs, { _tag: 'Draw', id: 'a' }, attempt)),
    )
    expect(outcomes).toEqual([['retry'], ['retry'], ['ack']])
    expect(ran).toEqual(['draw a #1', 'draw a #2', 'draw a #3', 'give up a'])
  })

  test('gets one more delivery when giving up failed, which only gives up', async () => {
    const { ran, jobs } = recording(9, 1)
    const last = await Effect.runPromise(deliver(jobs, { _tag: 'Draw', id: 'a' }, 3))
    const spare = await Effect.runPromise(deliver(jobs, { _tag: 'Draw', id: 'a' }, 4))
    expect([last, spare]).toEqual([['retry'], ['ack']])
    expect(ran).toEqual(['draw a #3', 'give up a', 'give up a'])
  })

  test('drops a body that is no case of the queue, running nothing', async () => {
    const { ran, jobs } = recording(0)
    expect(await Effect.runPromise(deliver(jobs, { pieceId: 'pc_1' }, 1))).toEqual(['ack'])
    expect(ran).toEqual([])
  })

  test('runs under its queue, the job it carries and its attempt, on its own span', async () => {
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      },
    })
    const { jobs } = recording(0)
    await Effect.runPromise(
      deliver(jobs, { _tag: 'Draw', id: 'gj_1' }, 2).pipe(Effect.provideService(Tracer.Tracer, tracer)),
    )
    expect(spans[0]?.name).toBe('styld.queue')
    expect(Object.fromEntries(spans[0]?.attributes ?? [])).toEqual({
      'styld.environment': 'preview',
      'styld.release': 'cb10b19',
      'styld.component': 'server',
      'styld.kind': 'queue.pieces',
      'styld.job_id': 'gj_1',
      'styld.attempt': 2,
    })
  })
})

describe('the queues', () => {
  test('name the job each delivery carries; a piece keeps the message id', () => {
    expect(generationJobQueue.jobOf({ _tag: 'TakeJob', jobId: 'gj_1' })).toEqual(Option.some('gj_1'))
    expect(checkJobQueue.jobOf({ _tag: 'CheckContent', target: { kind: 'board', id: 'bd_1' } })).toEqual(
      Option.some('board:bd_1'),
    )
    expect(pieceJobQueue.jobOf({ _tag: 'ProcessPiece', pieceId: 'pc_1' })).toEqual(Option.none())
  })

  test('tell Cloudflare one spare delivery past the attempts that run the work', () => {
    expect(consumerSettings(pieceJobQueue)).toEqual({ batchSize: 10, maxRetries: 3, retryDelay: '10 seconds' })
  })
})
