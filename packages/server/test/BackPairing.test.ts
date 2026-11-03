import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { CaptureStore } from '../src/capture/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { localD1 } from './LocalD1.ts'

// The guided camera takes a piece's front, then its back: whichever shot finishes second pairs them. A person may keep
// the front before the back is ready; the back then goes to the piece the front became (3 November).

/** A front shot with one cut-out card, open or kept as a piece (with or without a back already). */
const seeded = (front: 'open' | 'kept' | 'keptWithBack') => {
  const database = localD1()
  const sqlite = database.sqlite
  sqlite.exec("INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)")
  sqlite.exec(
    `INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
     VALUES ('up_1', 'ac_1', 'd', 'image/png', 1, 'k/up_1', 'used', 0)`,
  )
  sqlite.exec(
    `INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes, side,
       credits, attempt, created_at, updated_at)
     VALUES ('cp_front', 'ac_1', 'photo', 'camera', 'review', 'up_1', 'k/up_1', 'image/png', 1, 'front', 0, 0, 0, 0)`,
  )
  sqlite.exec(
    `INSERT INTO detections (id, capture_id, account_id, status, cutout_key, source_key, preselected,
       suggested_colours, suggested_occasions, created_at)
     VALUES ('dt_front', 'cp_front', 'ac_1', '${front === 'open' ? 'review' : 'kept'}', 'k/front.png', 'k/up_1', 1,
       '[]', '[]', 0)`,
  )
  if (front !== 'open')
    sqlite.exec(
      `INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, detection_id, back_image_key,
         original_key, image_key, content_type, created_at, updated_at)
       VALUES ('pc_1', 'ac_1', 'tops', '[]', '[]', 'ready', 'website', 'dt_front',
         ${front === 'keptWithBack' ? "'k/earlier-back.png'" : 'NULL'}, 'k/up_1', 'k/front.png', 'image/png', 0, 0)`,
    )
  return database
}

const attached = (database: ReturnType<typeof seeded>) =>
  Effect.flatMap(CaptureStore, (store) => store.attachBack('ac_1', 'cp_front', 'k/back.png')).pipe(
    Effect.provide(CaptureStore.layer.pipe(Layer.provide(Database.layer(database)))),
  )

const one = (database: ReturnType<typeof seeded>, sql: string) => database.sqlite.prepare(sql).get()

describe("a piece's back from the guided camera", () => {
  it.effect('goes to the open card of its front', () => {
    const database = seeded('open')
    return Effect.gen(function* () {
      expect(yield* attached(database)).toBe(true)
      expect(one(database, "SELECT back_cutout_key AS back FROM detections WHERE id = 'dt_front'")).toEqual({
        back: 'k/back.png',
      })
    })
  })

  it.effect('goes to the piece the front became when it was kept first', () => {
    const database = seeded('kept')
    return Effect.gen(function* () {
      expect(yield* attached(database)).toBe(true)
      expect(one(database, "SELECT back_image_key AS back FROM pieces WHERE id = 'pc_1'")).toEqual({
        back: 'k/back.png',
      })
    })
  })

  it.effect('never replaces a back the piece already has', () => {
    const database = seeded('keptWithBack')
    return Effect.gen(function* () {
      expect(yield* attached(database)).toBe(false)
      expect(one(database, "SELECT back_image_key AS back FROM pieces WHERE id = 'pc_1'")).toEqual({
        back: 'k/earlier-back.png',
      })
    })
  })
})
