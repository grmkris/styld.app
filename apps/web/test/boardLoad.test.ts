import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { TestClock } from 'effect/testing'
import { boardReadPatience, LoadBoard } from '../src/page/Board/Commands.ts'
import { ReloadBoard } from '../src/page/Board/PageCommands.ts'
import { Message } from '../src/page/Board/Message.ts'
import { StyldClient, styldClientLayer } from '../src/StyldClient.ts'

// A board read that never answers (browser review, 2 November 2026: the board stayed on its shape for over 90
// seconds) gives up after its patience, is tried once more, and then the page offers Try again.

const origin = 'https://styld.test'
const board = {
  id: `bd_${'weekend'.padEnd(22, 'x')}`,
  name: 'Weekend',
  paper: 'paper',
  version: 1,
  items: [],
  pins: [],
  publicPins: [],
  moods: [],
  visibility: 'private',
  check: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
}

/** The API answering the board reads in turn: `never` holds the request open, a board answers it. */
const server = (answers: ReadonlyArray<'never' | 'board'>, asked: Array<string>) =>
  styldClientLayer(origin).pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          asked.push(new URL(request.url).pathname)
          return answers[asked.length - 1] === 'board'
            ? Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(board)))
            : Effect.never
        }),
      ),
    ),
  )

/** Start a board read once the typed client has loaded (its code loads the first time it is asked for), and let it
 * run until the server has been asked `count` times. */
const started = <A, E, R>(read: Effect.Effect<A, E, R>, asked: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* (yield* StyldClient).api
    const fiber = yield* Effect.forkChild(read)
    yield* untilAsked(asked, 1)
    return fiber
  })

/** Let the read run until the server has been asked `count` times. */
const untilAsked = (asked: ReadonlyArray<string>, count: number) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 1000 && asked.length < count; turn++) yield* Effect.yieldNow
  })

describe('reading a board', () => {
  it.effect('a read that never answers is tried once more, then fails as unavailable for Try again', () => {
    const asked: Array<string> = []
    return Effect.gen(function* () {
      const loading = yield* started(LoadBoard({ boardId: board.id }).effect, asked)
      yield* TestClock.adjust(boardReadPatience)
      yield* untilAsked(asked, 2)
      expect(asked).toHaveLength(2)
      yield* TestClock.adjust(boardReadPatience)
      expect(yield* Fiber.join(loading)).toEqual(Message.FailedLoadBoard({ error: 'Unavailable' }))
      // Never read as someone else's public board: a slow read is not a missing one.
      expect(asked).toEqual([`/api/boards/${board.id}`, `/api/boards/${board.id}`])
    }).pipe(Effect.provide(server(['never', 'never'], asked)))
  })

  it.effect('a second try that answers shows the board', () => {
    const asked: Array<string> = []
    return Effect.gen(function* () {
      const loading = yield* started(LoadBoard({ boardId: board.id }).effect, asked)
      yield* TestClock.adjust(boardReadPatience)
      expect(yield* Fiber.join(loading)).toMatchObject({ _tag: 'SucceededLoadBoard' })
      expect(asked).toHaveLength(2)
    }).pipe(Effect.provide(server(['never', 'board'], asked)))
  })

  it.effect('a reload that never answers keeps what the page shows', () => {
    const asked: Array<string> = []
    return Effect.gen(function* () {
      const reloading = yield* started(ReloadBoard({ boardId: board.id }).effect, asked)
      yield* TestClock.adjust(boardReadPatience)
      yield* untilAsked(asked, 2)
      yield* TestClock.adjust(boardReadPatience)
      expect(yield* Fiber.join(reloading)).toMatchObject({ _tag: 'CompletedReloadBoard' })
    }).pipe(Effect.provide(server(['never', 'never'], asked)))
  })
})
