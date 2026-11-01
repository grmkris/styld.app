import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { applicationSweeps } from '../src/jobs/Cron.ts'
import { runSweeps, stuckRows, sweepBatch } from '../src/jobs/Sweeps.ts'
import { forgetOldReceipts } from '../src/kernel/Receipts.ts'
import { forgetExpiredAssertions } from '../src/OAuthAssertions.ts'
import { checkRows } from '../src/safety/Checks.ts'
import { makeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

const minute = 60_000
const now = Date.now()
/** Thirty minutes is the patience: an hour ago is stuck, ten minutes ago is still working. */
const old = now - 60 * minute
const recent = now - 10 * minute
const until = new Date(now - 30 * minute)
const nowDate = new Date(now)
const aDayAgo = new Date(now - 24 * 60 * minute)
const twoHoursAgo = new Date(now - 2 * 60 * minute)
const notUsed = () => Effect.die('not used')

/** A database with one account. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  return database
}

const piece = (database: ReturnType<typeof seeded>, id: string, status: string, updatedAt: number) =>
  database.sqlite.exec(
    `INSERT INTO pieces (id, account_id, colours, status, source, original_key, content_type, bytes, created_at, updated_at)
     VALUES ('${id}', 'ac_1', '[]', '${status}', 'upload', 'k/${id}', 'image/png', 1, 0, ${updatedAt})`,
  )

describe('the sweeps', () => {
  it.effect('find pieces stuck processing, oldest first, and leave the ones still working or done', () =>
    Effect.gen(function* () {
      const database = seeded()
      piece(database, 'pc_new', 'processing', recent)
      piece(database, 'pc_old', 'processing', old)
      piece(database, 'pc_older', 'processing', old - minute)
      piece(database, 'pc_ready', 'ready', old)
      expect(yield* stuckRows(database).pieces(until)).toEqual(['pc_older', 'pc_old'])
    }),
  )

  it.effect('find captures stuck processing, never one in the tray or failed', () =>
    Effect.gen(function* () {
      const database = seeded()
      const capture = (id: string, status: string, updatedAt: number) =>
        database.sqlite.exec(
          `INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes,
             credits, settlement, created_at, updated_at)
           VALUES ('${id}', 'ac_1', 'photo', 'picker', '${status}', 'up_${id}', 'k', 'image/png', 1, 1, 'held', 0,
             ${updatedAt})`,
        )
      capture('cp_stuck', 'processing', old)
      capture('cp_working', 'processing', recent)
      capture('cp_review', 'review', old)
      capture('cp_unknown', 'unknown', old)
      expect(yield* stuckRows(database).captures(until)).toEqual(['cp_stuck'])
    }),
  )

  it.effect('find clean pictures stuck queued, drawing or checking', () =>
    Effect.gen(function* () {
      const database = seeded()
      for (const [id, state, at] of [
        ['pc_q', 'queued', old],
        ['pc_g', 'generating', old + minute],
        ['pc_c', 'checking', old - minute],
        ['pc_r', 'ready', old],
        ['pc_w', 'generating', recent],
      ] as const) {
        piece(database, id, 'ready', 0)
        database.sqlite.exec(
          `INSERT INTO piece_pictures (piece_id, account_id, state, version, created_at, updated_at)
           VALUES ('${id}', 'ac_1', '${state}', 0, 0, ${at})`,
        )
      }
      expect(yield* stuckRows(database).pictures(until)).toEqual(['pc_c', 'pc_q', 'pc_g'])
    }),
  )

  it.effect('find turns stuck on their way, and videos no browser cut into frames within two hours', () =>
    Effect.gen(function* () {
      const database = seeded()
      for (const [id, state, at] of [
        ['pc_req', 'requested', old],
        ['pc_gen', 'generating', recent],
        ['pc_vr_old', 'video-ready', now - 3 * 60 * minute],
        ['pc_vr_new', 'video-ready', old],
        ['pc_ready', 'ready', old],
      ] as const) {
        piece(database, id, 'ready', 0)
        database.sqlite.exec(
          `INSERT INTO piece_turns (piece_id, account_id, state, created_at, updated_at)
           VALUES ('${id}', 'ac_1', '${state}', 0, ${at})`,
        )
      }
      expect(yield* stuckRows(database).turns(until, twoHoursAgo)).toEqual(['pc_vr_old', 'pc_req'])
    }),
  )

  it.effect('find outfit photos stuck finding their garments', () =>
    Effect.gen(function* () {
      const database = seeded()
      const photo = (id: string, status: string, updatedAt: number) =>
        database.sqlite.exec(
          `INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, created_at,
             updated_at)
           VALUES ('${id}', 'ac_1', 'up_${id}', 'k', 'image/jpeg', '${status}', 0, ${updatedAt})`,
        )
      photo('ph_stuck', 'finding', old)
      photo('ph_working', 'finding', recent)
      photo('ph_ready', 'ready', old)
      expect(yield* stuckRows(database).photos(until)).toEqual(['ph_stuck'])
    }),
  )

  it.effect('move a batch at a time', () =>
    Effect.gen(function* () {
      const database = seeded()
      for (let index = 0; index < sweepBatch + 5; index += 1) piece(database, `pc_${index}`, 'processing', old)
      expect((yield* stuckRows(database).pieces(until)).length).toBe(sweepBatch)
    }),
  )

  it.effect('forget uploads nothing used: expired paths, and bytes unused a day after, never used ones', () =>
    Effect.gen(function* () {
      const database = seeded()
      const upload = (id: string, status: string, expiresAt: number) =>
        database.sqlite.exec(
          `INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
           VALUES ('${id}', 'ac_1', 'd', 'image/png', 1, 'k/${id}', '${status}', ${expiresAt})`,
        )
      upload('up_never_came', 'pending', now - minute)
      upload('up_still_open', 'pending', now + minute)
      upload('up_left_unused', 'received', now - 25 * 60 * minute)
      upload('up_just_received', 'received', now - minute)
      upload('up_used', 'used', now - 25 * 60 * minute)
      const store = makeStore(database)
      const unused = yield* store.unusedUploads(nowDate, aDayAgo, sweepBatch)
      expect(unused.map(({ id }) => id).toSorted()).toEqual(['up_left_unused', 'up_never_came'])
      yield* Effect.forEach(unused, ({ id }) => store.forgetUpload(id))
      const left = database.sqlite.prepare('SELECT id FROM uploads ORDER BY id').all()
      expect(left.map(({ id }) => id)).toEqual(['up_just_received', 'up_still_open', 'up_used'])
    }),
  )

  it.live('forget operation receipts older than 30 days', () =>
    Effect.gen(function* () {
      const database = seeded()
      const receipt = (id: string, createdAt: number) =>
        database.sqlite.exec(
          `INSERT INTO operation_receipts (account_id, operation_id, command, input_digest, result, created_at)
           VALUES ('ac_1', '${id}', 'createBoard', 'd', 'bd_1', ${createdAt})`,
        )
      receipt('op-old', now - 31 * 24 * 60 * minute)
      receipt('op-new', now - 29 * 24 * 60 * minute)
      expect(yield* forgetOldReceipts(drizzle(database), 500)).toBe(1)
      expect(database.sqlite.prepare('SELECT operation_id FROM operation_receipts').all()).toEqual([
        { operation_id: 'op-new' },
      ])
    }),
  )

  it.live('forget OAuth assertions past their expiry', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(
        `INSERT INTO oauth_assertions (namespace, receipt, expires_at) VALUES ('mcp', 'gone', ${now - minute}),
           ('mcp', 'live', ${now + minute})`,
      )
      expect(yield* forgetExpiredAssertions(database, 500)).toBe(1)
      expect(database.sqlite.prepare('SELECT receipt FROM oauth_assertions').all()).toEqual([{ receipt: 'live' }])
    }),
  )

  it.effect('abandon a pending check whose target is gone, keeping answered ones', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(
        `INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, attempts, requested_at)
         VALUES ('board', 'bd_gone', 'ac_1', 'd', 'pending', 0, ${old}),
           ('board', 'bd_passed', 'ac_1', 'd', 'passed', 1, ${old})`,
      )
      const rows = checkRows(drizzle(database))
      expect((yield* rows.stalePending(until, sweepBatch)).map(({ id }) => id)).toEqual(['bd_gone'])
      yield* rows.abandon({ kind: 'board', id: 'bd_gone' })
      yield* rows.abandon({ kind: 'board', id: 'bd_passed' })
      expect(yield* rows.stalePending(until, sweepBatch)).toEqual([])
      expect(database.sqlite.prepare('SELECT target_id FROM content_checks').all()).toEqual([
        { target_id: 'bd_passed' },
      ])
    }),
  )

  it.effect('run every sweep on its own: one that fails skips none of the others', () =>
    Effect.gen(function* () {
      const ran: Array<string> = []
      yield* runSweeps([
        { name: 'broken', run: Effect.die('down') },
        { name: 'failing', run: Effect.fail('down') },
        { name: 'fine', run: Effect.sync(() => ran.push('fine')) },
      ])
      expect(ran).toEqual(['fine'])
    }),
  )

  it('are all on the schedule', () => {
    const sweeps = applicationSweeps(seeded(), {
      wardrobeService: { failPiece: notUsed, sweepUploads: notUsed },
      capturesService: { failCapture: notUsed, failPicture: notUsed, failTurn: notUsed },
      photosService: { failFinding: notUsed },
      generationsService: { sweep: notUsed },
      checksService: { sweep: notUsed },
      outfitsService: { sweep: notUsed },
    })
    expect(sweeps.map(({ name }) => name)).toEqual([
      'pieces',
      'captures',
      'pictures',
      'turns',
      'photos',
      'generation',
      'checks',
      'thinking',
      'uploads',
      'receipts',
      'assertions',
    ])
  })
})
