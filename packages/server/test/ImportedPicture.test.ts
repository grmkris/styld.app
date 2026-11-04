import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { queueImportedPicture } from '../src/capture/ImportedPicture.ts'
import { CaptureStore } from '../src/capture/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { PieceQueue } from '../src/wardrobe/Processing.ts'
import { WardrobeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

// A piece imported from v1 gets its first clean picture once it is ready as a cut-out, over real SQLite: queued as a
// first drawing, paid by Styld, and the picture row is the receipt a redelivered import finds. The job's drawing is
// the native import journey's (ImportAcceptance.ts).

/** Ana's imported pieces: ready as a cut-out, kept as its photo, still processing; and a ready cut-out kept from the
 * tray, which got its picture when it was kept. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
  `)
  const piece = (id: string, status: string, source: string, cutOut: boolean) =>
    database.sqlite.exec(
      `INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key,
         content_type, created_at, updated_at)
       VALUES ('${id}', 'ac_1', 'shortSleeveTops', '[]', '[]', '${status}', '${source}', 'k/${id}',
         ${cutOut ? `'c/${id}'` : status === 'ready' ? `'k/${id}'` : 'NULL'}, 'image/png', 0, 0)`,
    )
  piece('pc_cutout', 'ready', 'import', true)
  piece('pc_photo', 'ready', 'import', false)
  piece('pc_processing', 'processing', 'import', false)
  piece('pc_kept', 'ready', 'website', true)
  const sent: Array<unknown> = []
  const queue = PieceQueue.layer({
    send: (message) => Promise.resolve(sent.push(message)),
    sendBatch: () => Promise.resolve(),
  })
  const stores = Layer.mergeAll(CaptureStore.layer, WardrobeStore.layer).pipe(Layer.provide(Database.layer(database)))
  return { database, sent, layer: Layer.mergeAll(stores, queue) }
}

describe("an imported piece's clean picture", () => {
  it.effect(
    'is queued once it is ready as a cut-out, as a first drawing paid by Styld, once however often asked',
    () => {
      const { database, sent, layer } = seeded()
      return Effect.gen(function* () {
        yield* queueImportedPicture('pc_cutout')
        // The import is delivered again: the row is there, and a picture still waiting is sent again.
        yield* queueImportedPicture('pc_cutout')
        const rows = database.sqlite.prepare('SELECT piece_id, state, version, redraws, paid FROM piece_pictures').all()
        expect(rows).toEqual([{ piece_id: 'pc_cutout', state: 'queued', version: 0, redraws: 0, paid: 0 }])
        expect(sent).toEqual([
          { _tag: 'DrawPicture', pieceId: 'pc_cutout' },
          { _tag: 'DrawPicture', pieceId: 'pc_cutout' },
        ])
        // Once drawn, a later redelivery leaves it alone.
        database.sqlite.exec("UPDATE piece_pictures SET state = 'ready', version = 1 WHERE piece_id = 'pc_cutout'")
        yield* queueImportedPicture('pc_cutout')
        expect(sent).toHaveLength(2)
        expect(database.sqlite.prepare('SELECT state, version FROM piece_pictures').get()).toEqual({
          state: 'ready',
          version: 1,
        })
      }).pipe(Effect.provide(layer))
    },
  )

  it.effect('is never queued for a house garment the seed generated: its picture already is a clean one', () => {
    const { database, sent, layer } = seeded()
    database.sqlite.exec(`
      INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, model, prompt_digest, updated_at)
      VALUES ('pc_cutout', 'ac_1', 'generated', 'w-knitwear-beige', 'muse-image-1.0', 'd', 0);
    `)
    return Effect.gen(function* () {
      yield* queueImportedPicture('pc_cutout')
      expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM piece_pictures').get()).toEqual({ n: 0 })
      expect(sent).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('is never queued for a piece kept as its photo, one still processing, or one kept from the tray', () => {
    const { database, sent, layer } = seeded()
    return Effect.gen(function* () {
      yield* Effect.forEach(['pc_photo', 'pc_processing', 'pc_kept', 'pc_missing'], queueImportedPicture)
      expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM piece_pictures').get()).toEqual({ n: 0 })
      expect(sent).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})
