import { describe, expect, it, test } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Exit, Option } from 'effect'
import {
  advanceCapture,
  batchedCaptureMoves,
  captureLifecycle,
  endingOf,
  offeredCaptureState,
  uploadedCaptureState,
} from '../src/capture/CaptureLifecycle.ts'
import { localD1 } from './LocalD1.ts'

// A capture's lifecycle (`capture/CaptureLifecycle.ts`): the table of moves every writer of `captures.status` goes
// along, the moves written inside other batches, and how each state ends the capture's hold.

const { canMove, moves } = captureLifecycle
const read = new Date(5)
const retried = new Date(6)

describe('a capture’s lifecycle', () => {
  test('processes an upload into the tray, or fails it, or waits with its answer lost; a stuck one is tried again', () => {
    for (const to of ['review', 'failed', 'unknown', 'processing'] as const)
      expect(canMove('processing', to)).toBe(true)
    expect(canMove('review', 'done')).toBe(true)
    expect(canMove('failed', 'processing')).toBe(true)
    expect(canMove('unknown', 'processing')).toBe(true)
  })

  test('refuses a retry from the tray, a tray card that skips processing, and anything after done', () => {
    expect(canMove('review', 'processing')).toBe(false)
    expect(canMove('failed', 'review')).toBe(false)
    expect(canMove('unknown', 'done')).toBe(false)
    expect(canMove('processing', 'done')).toBe(false)
    expect(moves.done).toEqual([])
  })

  test('starts an upload processing and an offered garment in the tray, and batches only moves on the table', () => {
    expect(uploadedCaptureState).toBe('processing')
    expect(offeredCaptureState).toBe('review')
    for (const { from, to } of Object.values(batchedCaptureMoves))
      for (const state of from) expect(canMove(state, to)).toBe(true)
  })

  test('ends a hold succeeded in the tray or done, failed or unknown otherwise, and not while processing', () => {
    expect(endingOf('review')).toEqual(Option.some('succeeded'))
    expect(endingOf('done')).toEqual(Option.some('succeeded'))
    expect(endingOf('failed')).toEqual(Option.some('failed'))
    expect(endingOf('unknown')).toEqual(Option.some('unknown'))
    expect(endingOf('processing')).toEqual(Option.none())
  })

  it.effect('moves a capture only from the state, attempt and moment it was read in, and never off the table', () =>
    Effect.gen(function* () {
      const database = localD1()
      database.sqlite.exec(`
        INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
        INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
          VALUES ('up_1', 'ac_1', 'd', 'image/png', 1, 'k/up_1', 'used', 0);
        INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes,
          credits, attempt, created_at, updated_at)
          VALUES ('cp_1', 'ac_1', 'photo', 'picker', 'failed', 'up_1', 'k/up_1', 'image/png', 1, 1, 0, 0, 5);
      `)
      const db = drizzle(database)
      const capture = { id: 'cp_1', accountId: 'ac_1' }
      const seen = { status: 'failed', attempt: 0, updatedAt: read } as const
      const exit = yield* Effect.exit(advanceCapture(db, capture, seen, 'done', {}))
      expect(Exit.hasDies(exit)).toBe(true)
      const next = { attempt: 1, updatedAt: retried }
      expect(yield* advanceCapture(db, capture, seen, 'processing', next)).toBe(true)
      expect(yield* advanceCapture(db, capture, seen, 'processing', next)).toBe(false)
      expect(database.sqlite.prepare("SELECT status, attempt FROM captures WHERE id = 'cp_1'").get()).toEqual({
        status: 'processing',
        attempt: 1,
      })
    }),
  )
})
