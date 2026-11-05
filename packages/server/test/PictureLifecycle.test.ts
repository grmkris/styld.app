import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, test } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Exit } from 'effect'
import {
  advancePicture,
  drawnStates,
  firstPictureState,
  hasEnded,
  pictureLifecycle,
  redrawable,
} from '../src/capture/PictureLifecycle.ts'
import { localD1 } from './LocalD1.ts'

// The drawing lifecycle of a piece's pictures (`capture/PictureLifecycle.ts`): the table of moves every writer goes
// along, the states a drawing ends in, and the migration that moved the states from before 4 November to today's.

const { canMove, moves } = pictureLifecycle

describe('a piece picture’s lifecycle', () => {
  test('moves a queued drawing to its claim, or to the end the job or a taken-back redraw gives it', () => {
    for (const to of ['generating', 'kept-real', 'retake', 'failed', 'ready', 'proposed'] as const)
      expect(canMove('queued', to)).toBe(true)
    for (const to of ['ready', 'failed', 'queued'] as const) expect(canMove('generating', to)).toBe(true)
    expect(canMove('proposed', 'ready')).toBe(true)
  })

  test('refuses a drawing that skips its claim, or goes back to drawing without a new one', () => {
    expect(canMove('ready', 'generating')).toBe(false)
    expect(canMove('failed', 'ready')).toBe(false)
    expect(canMove('generating', 'retake')).toBe(false)
    expect(canMove('retake', 'kept-real')).toBe(false)
    expect(canMove('ready', 'proposed')).toBe(false)
  })

  test('leaves an ended drawing only by queueing a new one, or showing one proposed before 4 November', () => {
    for (const state of ['ready', 'proposed', 'retake', 'kept-real', 'failed'] as const) {
      expect(hasEnded(state)).toBe(true)
      expect(
        moves[state].filter((to) => to !== firstPictureState && !(state === 'proposed' && to === 'ready')),
      ).toEqual([])
    }
  })

  test('queues again only drawings that ended, and shows only ready or proposed ones', () => {
    for (const state of [...redrawable.every, ...redrawable.ended]) expect(canMove(state, firstPictureState)).toBe(true)
    expect(drawnStates.every(hasEnded)).toBe(true)
    expect(hasEnded('queued') || hasEnded('generating')).toBe(false)
  })

  it.effect('writes nothing for a move off the table', () =>
    Effect.gen(function* () {
      const database = localD1()
      database.sqlite.exec(`
        INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
        INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type,
          created_at, updated_at) VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0);
        INSERT INTO piece_pictures (piece_id, account_id, state, version, redraws, paid, created_at, updated_at)
          VALUES ('pc_1', 'ac_1', 'ready', 1, 0, 0, 0, 0);
      `)
      const exit = yield* Effect.exit(advancePicture(drizzle(database), 'pc_1', ['ready'], 'generating', {}))
      expect(Exit.hasDies(exit)).toBe(true)
      expect(database.sqlite.prepare("SELECT state FROM piece_pictures WHERE piece_id = 'pc_1'").get()).toEqual({
        state: 'ready',
      })
      expect(yield* advancePicture(drizzle(database), 'pc_1', ['ready'], 'queued', {})).toBe(true)
      expect(yield* advancePicture(drizzle(database), 'pc_1', ['ready'], 'queued', {})).toBe(false)
    }),
  )
})

// The states the check left before 4 November: a drawing still `checking` is shown, or failed without a drawing; one
// `rejected` failed. Plain UPDATEs with foreign keys on, as D1 runs them: every other row stays as it was.
test('the legacy picture states migration moves checking and rejected drawings, and touches nothing else', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys = ON')
    const migrations = new URL('../../db/migrations/', import.meta.url)
    const target = '20261105145014_picture_legacy_states'
    for (const folder of readdirSync(migrations)
      .toSorted()
      .filter((name) => name < target))
      db.exec(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'))
    db.exec(`
      INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0);
      INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0),
               ('pc_2', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0),
               ('pc_3', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0),
               ('pc_4', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k', 'image/png', 0, 0);
      INSERT INTO piece_pictures (piece_id, account_id, state, clean_key, version, redraws, paid, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'checking', 'c/1', 1, 0, 0, 0, 5),
               ('pc_2', 'ac_1', 'checking', NULL, 1, 0, 0, 0, 5),
               ('pc_3', 'ac_1', 'rejected', 'c/3', 1, 0, 0, 0, 5),
               ('pc_4', 'ac_1', 'proposed', 'c/4', 1, 0, 0, 0, 5);
      INSERT INTO piece_back_pictures (piece_id, account_id, state, source_key, clean_key, version, created_at, updated_at)
        VALUES ('pc_1', 'ac_1', 'rejected', 'b/1', NULL, 1, 0, 5),
               ('pc_2', 'ac_1', 'checking', 'b/2', 'bc/2', 1, 0, 5),
               ('pc_3', 'ac_1', 'queued', 'b/3', NULL, 0, 0, 5);
    `)
    db.exec('BEGIN')
    db.exec(readFileSync(new URL(`${target}/migration.sql`, migrations), 'utf8'))
    db.exec('COMMIT')
    const rows = (table: string) =>
      db.prepare(`SELECT piece_id, state, clean_key, updated_at FROM ${table} ORDER BY piece_id`).all()
    expect(rows('piece_pictures')).toEqual([
      { piece_id: 'pc_1', state: 'ready', clean_key: 'c/1', updated_at: 5 },
      { piece_id: 'pc_2', state: 'failed', clean_key: null, updated_at: 5 },
      { piece_id: 'pc_3', state: 'failed', clean_key: 'c/3', updated_at: 5 },
      { piece_id: 'pc_4', state: 'proposed', clean_key: 'c/4', updated_at: 5 },
    ])
    expect(rows('piece_back_pictures')).toEqual([
      { piece_id: 'pc_1', state: 'failed', clean_key: null, updated_at: 5 },
      { piece_id: 'pc_2', state: 'ready', clean_key: 'bc/2', updated_at: 5 },
      { piece_id: 'pc_3', state: 'queued', clean_key: null, updated_at: 5 },
    ])
    expect(db.prepare('SELECT count(*) AS pieces FROM pieces').get()).toEqual({ pieces: 4 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    db.close()
  }
})
