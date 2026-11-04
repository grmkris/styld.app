import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { backfillRows } from '../src/capture/BackfillStore.ts'
import { localD1 } from './LocalD1.ts'

// The operator's backfill of clean pictures over real SQLite: which pieces it finds, that adding their pictures twice
// adds each once, and that a drawing proposed before 4 November is shown. The queue and the job are the native
// suite's (CleanPictureAcceptance.ts › verifyBackfill).

/** Two accounts; Ana's pieces: two cut-outs with no picture (the older first), one kept as its photo, one still
 * processing, one already drawn and one whose drawing was proposed. Bob's cut-out has none either. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0), ('ac_2', 0, 'Bob', 0);
  `)
  const piece = (id: string, account: string, status: string, cutOut: boolean, createdAt: number) =>
    database.sqlite.exec(
      `INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key,
         content_type, created_at, updated_at)
       VALUES ('${id}', '${account}', 'shortSleeveTops', '[]', '[]', '${status}', 'import', 'k/${id}', '${cutOut ? `c/${id}` : `k/${id}`}',
         'image/png', ${createdAt}, 0)`,
    )
  piece('pc_old', 'ac_1', 'ready', true, 1)
  piece('pc_new', 'ac_1', 'ready', true, 2)
  piece('pc_photo', 'ac_1', 'ready', false, 3)
  piece('pc_processing', 'ac_1', 'processing', true, 4)
  piece('pc_drawn', 'ac_1', 'ready', true, 5)
  piece('pc_proposed', 'ac_1', 'ready', true, 6)
  piece('pc_bob', 'ac_2', 'ready', true, 7)
  database.sqlite.exec(`
    INSERT INTO piece_pictures (piece_id, account_id, state, clean_key, version, redraws, paid, created_at, updated_at)
    VALUES ('pc_drawn', 'ac_1', 'ready', 'c/drawn', 1, 0, 0, 0, 0),
           ('pc_proposed', 'ac_1', 'proposed', 'c/proposed', 1, 0, 0, 0, 0);
  `)
  return database
}

/** Moments of the test, outside its Effects. */
const at = (millis: number) => new Date(millis)
const [start, first, second, before, later] = [at(0), at(1), at(2), at(5_000), at(10_000)]

const queued = (pieceId: string) => ({
  pieceId,
  accountId: 'ac_1',
  state: 'queued' as const,
  version: 0,
  redraws: 0,
  paid: false,
  createdAt: start,
  updatedAt: start,
})

describe("the operator's backfill of clean pictures", () => {
  it.effect('finds the account’s ready cut-outs without a picture, newest first, never a photo', () =>
    Effect.gen(function* () {
      const rows = backfillRows(drizzle(seeded()))
      expect(yield* rows.undrawnPieces('ac_1')).toEqual(['pc_new', 'pc_old'])
    }),
  )

  it.effect('never finds a house garment the seed generated, whose picture already is a clean one', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(`
        INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, model, prompt_digest, updated_at)
        VALUES ('pc_new', 'ac_1', 'generated', 'w-knitwear-beige', 'muse-image-1.0', 'd', 0),
               ('pc_old', 'ac_1', 'photo', 'w-coats-navy', NULL, NULL, 0);
      `)
      expect(yield* backfillRows(drizzle(database)).undrawnPieces('ac_1')).toEqual(['pc_old'])
    }),
  )

  it.effect('adds each picture once, however often it is asked, and then finds nothing left to draw', () =>
    Effect.gen(function* () {
      const database = seeded()
      const rows = backfillRows(drizzle(database))
      expect(yield* rows.addPictures([queued('pc_new'), queued('pc_old')])).toEqual(['pc_new', 'pc_old'])
      expect(yield* rows.addPictures([queued('pc_new'), queued('pc_old'), queued('pc_drawn')])).toEqual([])
      expect(yield* rows.undrawnPieces('ac_1')).toEqual([])
      const drawn = database.sqlite.prepare("SELECT state, paid FROM piece_pictures WHERE piece_id = 'pc_drawn'").get()
      expect(drawn).toEqual({ state: 'ready', paid: 0 })
    }),
  )

  it.effect('shows the drawings proposed before 4 November, once, and only the account’s own', () =>
    Effect.gen(function* () {
      const rows = backfillRows(drizzle(seeded()))
      expect(yield* rows.showProposed('ac_2', first)).toEqual([])
      expect(yield* rows.showProposed('ac_1', first)).toEqual(['pc_proposed'])
      expect(yield* rows.showProposed('ac_1', second)).toEqual([])
    }),
  )

  it.effect('finds the account’s pictures still waiting since before a moment, whose message may be lost', () =>
    Effect.gen(function* () {
      const rows = backfillRows(drizzle(seeded()))
      yield* rows.addPictures([queued('pc_old'), { ...queued('pc_new'), updatedAt: later }])
      expect(yield* rows.overduePictures('ac_1', before)).toEqual(['pc_old'])
    }),
  )

  it.effect(
    'queues again the ready pieces’ drawings that ended before a moment, once, leaving retakes and newer ones',
    () =>
      Effect.gen(function* () {
        const database = seeded()
        database.sqlite.exec(`
        INSERT INTO piece_pictures (piece_id, account_id, state, clean_key, version, redraws, paid, created_at, updated_at)
        VALUES ('pc_old', 'ac_1', 'retake', NULL, 0, 0, 0, 0, 0),
               ('pc_new', 'ac_1', 'rejected', NULL, 1, 0, 1, 0, 9000),
               ('pc_processing', 'ac_1', 'failed', NULL, 1, 0, 0, 0, 0),
               ('pc_bob', 'ac_2', 'ready', 'c/bob', 1, 0, 0, 0, 0);
      `)
        const rows = backfillRows(drizzle(database))
        expect(yield* rows.staleDrawings('ac_1', before, 'every')).toEqual(['pc_proposed', 'pc_drawn'])
        expect(yield* rows.staleDrawings('ac_1', later, 'every')).toEqual(['pc_proposed', 'pc_drawn', 'pc_new'])
        const turn = at(6_000)
        expect(
          yield* rows.requeueDrawings(
            [
              { pieceId: 'pc_drawn', turn },
              { pieceId: 'pc_new', turn },
            ],
            before,
            'every',
          ),
        ).toEqual(['pc_drawn'])
        const drawn = database.sqlite
          .prepare(
            "SELECT state, paid, claimed_at, updated_at, clean_key FROM piece_pictures WHERE piece_id = 'pc_drawn'",
          )
          .get()
        expect(drawn).toEqual({ state: 'queued', paid: 0, claimed_at: null, updated_at: 6_000, clean_key: 'c/drawn' })
        expect(yield* rows.staleDrawings('ac_1', before, 'every')).toEqual(['pc_proposed'])
        expect(yield* rows.requeueDrawings([{ pieceId: 'pc_drawn', turn }], before, 'every')).toEqual([])
      }),
  )

  // Owner, 4 November 2026: after the prompt fix and the refusal fallback, only the drawings that ended dropped or
  // failed are drawn again; a shown one is left alone, and a run resumed with the same moment never widens the set.
  it.effect('queues again only the drawings dropped or failed before a moment, once, leaving shown ones', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(`
        INSERT INTO piece_pictures (piece_id, account_id, state, clean_key, version, redraws, paid, created_at, updated_at)
        VALUES ('pc_old', 'ac_1', 'rejected', NULL, 1, 0, 0, 0, 0),
               ('pc_new', 'ac_1', 'failed', NULL, 1, 0, 0, 0, 0),
               ('pc_photo', 'ac_1', 'failed', NULL, 1, 0, 0, 0, 9000),
               ('pc_bob', 'ac_2', 'rejected', NULL, 1, 0, 0, 0, 0);
      `)
      const rows = backfillRows(drizzle(database))
      const ended = yield* rows.staleDrawings('ac_1', before, 'ended')
      expect(ended).toEqual(['pc_new', 'pc_old'])
      const turn = at(6_000)
      const again = ended.map((pieceId) => ({ pieceId, turn }))
      // A shown drawing named by mistake is not queued either.
      expect(yield* rows.requeueDrawings([...again, { pieceId: 'pc_drawn', turn }], before, 'ended')).toEqual([
        'pc_new',
        'pc_old',
      ])
      const states = () =>
        database.sqlite.prepare('SELECT piece_id AS pieceId, state FROM piece_pictures ORDER BY piece_id').all()
      expect(states()).toEqual([
        { pieceId: 'pc_bob', state: 'rejected' },
        { pieceId: 'pc_drawn', state: 'ready' },
        { pieceId: 'pc_new', state: 'queued' },
        { pieceId: 'pc_old', state: 'queued' },
        { pieceId: 'pc_photo', state: 'failed' },
        { pieceId: 'pc_proposed', state: 'proposed' },
      ])
      // Drawn again and failed again after the moment: a repeat with the same moment queues nothing.
      database.sqlite.exec(`UPDATE piece_pictures SET state = 'failed', updated_at = 7000 WHERE piece_id = 'pc_new'`)
      expect(yield* rows.staleDrawings('ac_1', before, 'ended')).toEqual([])
      expect(yield* rows.requeueDrawings(again, before, 'ended')).toEqual([])
    }),
  )
})
