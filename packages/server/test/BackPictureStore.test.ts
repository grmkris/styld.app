import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { backPictureRows } from '../src/capture/BackPictureStore.ts'
import { backfillRows } from '../src/capture/BackfillStore.ts'
import { localD1 } from './LocalD1.ts'

// A piece's back picture over real SQLite (owner, 4 November: a pressed back, drawn only from a real one): queued once
// per back, queued again only when the back changes, moved only from the state it was read in, forgotten with its
// drawing when the back goes; and which pieces a camera back or the operator's backfill hands to the job.

/** Ana's pieces: one with a back from a kept detection of capture cp_1, one without a back, one still processing. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
      VALUES ('up_1', 'ac_1', 'd', 'image/png', 1, 'k/up_1', 'used', 0);
    INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes, side,
      credits, attempt, created_at, updated_at)
      VALUES ('cp_1', 'ac_1', 'photo', 'camera', 'done', 'up_1', 'k/cp_1', 'image/png', 1, 'front', 1, 0, 0, 0);
    INSERT INTO detections (id, capture_id, account_id, status, cutout_key, source_key, preselected,
      suggested_colours, suggested_occasions, created_at)
      VALUES ('dt_1', 'cp_1', 'ac_1', 'kept', 'c/dt_1', 'k/cp_1', 1, '[]', '[]', 0);
  `)
  const piece = (id: string, status: string, back: string | null, detection: string | null) =>
    database.sqlite.exec(
      `INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key,
         back_image_key, detection_id, content_type, created_at, updated_at)
       VALUES ('${id}', 'ac_1', 'shortSleeveTops', '[]', '[]', '${status}', 'website', 'k/${id}', 'c/${id}',
         ${back === null ? 'NULL' : `'${back}'`}, ${detection === null ? 'NULL' : `'${detection}'`}, 'image/png', 1, 0)`,
    )
  piece('pc_back', 'ready', 'b/one.png', 'dt_1')
  piece('pc_plain', 'ready', null, null)
  piece('pc_processing', 'processing', 'b/two.png', null)
  return database
}

const at = (millis: number) => new Date(millis)
const row = (sourceKey: string) => ({ pieceId: 'pc_back', accountId: 'ac_1', sourceKey })

describe('a piece’s back picture', () => {
  it.effect('is queued once for a back, again only for a new back, and moves only from the state it was read in', () =>
    Effect.gen(function* () {
      const rows = backPictureRows(drizzle(seeded()))
      expect(yield* rows.queueBackPicture(row('b/one.png'), at(1))).toBe(true)
      expect(yield* rows.moveBackPicture('pc_back', ['queued'], 'ready', { cleanKey: 'd/1.png' })).toBe(true)
      expect(yield* rows.moveBackPicture('pc_back', ['queued'], 'failed', {})).toBe(false)
      // The same back again: the drawing stands.
      expect(yield* rows.queueBackPicture(row('b/one.png'), at(2))).toBe(false)
      expect(Option.map(yield* rows.findBackPicture('pc_back'), ({ state }) => state)).toEqual(Option.some('ready'))
      // A new back: drawn again from it, the old drawing still named until the job claims the new one.
      expect(yield* rows.queueBackPicture(row('b/new.png'), at(3))).toBe(true)
      expect(yield* rows.findBackPicture('pc_back')).toEqual(
        Option.some(expect.objectContaining({ state: 'queued', sourceKey: 'b/new.png', cleanKey: 'd/1.png' })),
      )
      expect(yield* rows.dropBackPicture('pc_back')).toEqual(['d/1.png'])
      expect(yield* rows.findBackPicture('pc_back')).toEqual(Option.none())
    }),
  )

  it.effect('names the pieces a capture’s kept detections became that have a back', () =>
    Effect.gen(function* () {
      const rows = backPictureRows(drizzle(seeded()))
      expect(yield* rows.backedPiecesOf('ac_1', 'cp_1')).toEqual(['pc_back'])
      expect(yield* rows.backedPiecesOf('ac_1', 'cp_other')).toEqual([])
    }),
  )

  it.effect('is backfilled for each ready piece whose photographed back has no drawing of it, and not again', () =>
    Effect.gen(function* () {
      const db = drizzle(seeded())
      const backfill = backfillRows(db)
      expect(yield* backfill.undrawnBacks('ac_1')).toEqual(['pc_back'])
      yield* backPictureRows(db).queueBackPicture(row('b/one.png'), at(1))
      expect(yield* backfill.undrawnBacks('ac_1')).toEqual([])
      yield* backPictureRows(db).queueBackPicture(row('b/old.png'), at(2))
      expect(yield* backfill.undrawnBacks('ac_1')).toEqual(['pc_back'])
    }),
  )
})
