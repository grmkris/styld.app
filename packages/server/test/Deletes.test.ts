import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Exit } from 'effect'
import { boardStore } from '../src/boards/Store.ts'
import { deleting, type ReceiptRow } from '../src/kernel/Receipts.ts'
import { lookStore } from '../src/looks/Store.ts'
import { makeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

// A delete names its operation: its receipt goes in the delete's batch, so the same delete sent again (its answer was
// lost) answers done instead of NotFound, and the id used for another delete is a conflict. On SQLite with every
// migration, through each owner's own delete statement.

const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type,
        created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'ac_1/pc_1.jpg', 'image/jpeg', 0, 0);
    INSERT INTO looks (id, account_id, name, created_at) VALUES ('lk_1', 'ac_1', 'Friday', 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at)
      VALUES ('bd_1', 'ac_1', 'Autumn', 'paper', 0, 'private', '[]', ' autumn', 0, 0);
  `)
  return database
}

const count = (database: ReturnType<typeof seeded>, sql: string) =>
  Number(Object.values(database.sqlite.prepare(sql).get() ?? {})[0])

/** Send the same delete twice, then the same id for another target: how often it removed, and how the third ended. */
const sentAgain = (
  database: ReturnType<typeof seeded>,
  command: string,
  target: string | ReadonlyArray<string>,
  remove: (receipt: ReceiptRow) => Effect.Effect<boolean, unknown>,
) =>
  Effect.gen(function* () {
    const receipts = lookStore(drizzle(database))
    const deletion = { accountId: 'ac_1', operationId: `op-${command}`, command, target }
    let removed = 0
    const once = (receipt: ReceiptRow) =>
      Effect.flatMap(remove(receipt), (deleted) => Effect.sync(() => void (removed += deleted ? 1 : 0)))
    yield* deleting(receipts, deletion, once)
    yield* deleting(receipts, deletion, once)
    const otherTarget = typeof target === 'string' ? `${target}-other` : target.slice(1)
    const other = yield* Effect.exit(deleting(receipts, { ...deletion, target: otherTarget }, once))
    return { removed, other }
  })

const conflict = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && JSON.stringify(exit).includes('OperationConflict')

describe('a delete sent again', () => {
  it.effect('of a piece answers done, removing it once', () =>
    Effect.gen(function* () {
      const database = seeded()
      const store = makeStore(drizzle(database))
      const [piece] = yield* store.listPieces('ac_1')
      if (piece === undefined) return expect.unreachable()
      const { removed, other } = yield* sentAgain(database, 'deletePiece', 'pc_1', (receipt) =>
        Effect.as(store.deletePieces('ac_1', [piece], receipt), true),
      )
      expect(removed).toBe(1)
      expect(conflict(other)).toBe(true)
      expect(count(database, 'select count(*) from pieces')).toBe(0)
    }),
  )

  it.effect('of several pieces answers done, removing them once; fewer under the same id is a conflict', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(`
        INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
          VALUES ('up_2', 'ac_1', 'd', 'image/jpeg', 3, 'ac_1/pc_2.jpg', 'used', 0);
        INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type,
            upload_id, created_at, updated_at)
          VALUES ('pc_2', 'ac_1', 'jeans', '[]', '[]', 'ready', 'website', 'ac_1/pc_2.jpg', 'image/jpeg', 'up_2', 0, 0);
      `)
      const store = makeStore(drizzle(database))
      const rows = yield* store.listPieces('ac_1')
      const { removed, other } = yield* sentAgain(database, 'deletePieces', ['pc_1', 'pc_2'], (receipt) =>
        Effect.as(store.deletePieces('ac_1', rows, receipt), true),
      )
      expect(removed).toBe(1)
      expect(conflict(other)).toBe(true)
      expect(count(database, 'select count(*) from pieces')).toBe(0)
      expect(count(database, 'select count(*) from uploads')).toBe(0)
    }),
  )

  it.effect('of a look answers done, removing it once', () =>
    Effect.gen(function* () {
      const database = seeded()
      const store = lookStore(drizzle(database))
      const { removed, other } = yield* sentAgain(database, 'deleteLook', 'lk_1', (receipt) =>
        store.deleteLook('ac_1', 'lk_1', receipt),
      )
      expect(removed).toBe(1)
      expect(conflict(other)).toBe(true)
      expect(count(database, 'select count(*) from looks')).toBe(0)
    }),
  )

  it.effect('of a board answers done, removing it once', () =>
    Effect.gen(function* () {
      const database = seeded()
      const store = boardStore(drizzle(database))
      const { removed, other } = yield* sentAgain(database, 'deleteBoard', 'bd_1', (receipt) =>
        store.deleteBoard('ac_1', 'bd_1', receipt),
      )
      expect(removed).toBe(1)
      expect(conflict(other)).toBe(true)
      expect(count(database, 'select count(*) from boards')).toBe(0)
      expect(count(database, "select count(*) from operation_receipts where command = 'deleteBoard'")).toBe(1)
    }),
  )
})

/** A delete's receipt, as `deleting` hands it over. */
const cascadeReceipt: ReceiptRow = {
  accountId: 'ac_1',
  operationId: 'op-cascade',
  command: 'deletePieces',
  inputDigest: 'd',
  result: 'pc_1 pc_2',
  createdAt: new Date(0),
}

describe('pieces deleted at once', () => {
  it.effect('leave their looks, boards, worn days, pictures and checks; a photo keeps its garment', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(`
        INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_2', 0, 'Bob', 0);
        INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type,
            created_at, updated_at)
          VALUES ('pc_2', 'ac_1', 'jeans', '[]', '[]', 'ready', 'website', 'k2', 'image/png', 0, 0),
            ('pc_3', 'ac_2', 'tops', '[]', '[]', 'ready', 'website', 'k3', 'image/png', 0, 0);
        INSERT INTO look_pieces (look_id, piece_id, position) VALUES ('lk_1', 'pc_1', 0), ('lk_1', 'pc_2', 1);
        INSERT INTO board_pins (id, board_id, kind, piece_id, created_at) VALUES ('pn_1', 'bd_1', 'piece', 'pc_1', 0);
        INSERT INTO board_items (board_id, id, kind, piece_id, x, y, size, turn, z, flipped)
          VALUES ('bd_1', 'bi_1', 'piece', 'pc_2', 1, 1, 100, 0, 1, 0);
        INSERT INTO worn_pieces (account_id, day, piece_id, position) VALUES ('ac_1', '2026-11-03', 'pc_1', 0);
        INSERT INTO piece_pictures (piece_id, account_id, state, shown, version, redraws, paid, created_at, updated_at)
          VALUES ('pc_2', 'ac_1', 'ready', 'clean', 1, 0, 0, 0, 0);
        INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, requested_at)
          VALUES ('piece', 'pc_1', 'ac_1', 'd', 'passed', 0), ('piece', 'pc_3', 'ac_2', 'd', 'passed', 0);
        INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
          VALUES ('up_1', 'ac_1', 'd', 'image/jpeg', 3, 'photo.jpg', 'used', 0);
        INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, favourite,
            created_at, updated_at)
          VALUES ('ph_1', 'ac_1', 'up_1', 'photo.jpg', 'image/jpeg', 'ready', 0, 0, 0);
        INSERT INTO photo_garments (id, photo_id, account_id, position, cutout_key, type, colours, piece_id, state)
          VALUES ('pg_1', 'ph_1', 'ac_1', 0, 'cut.png', 'tops', '[]', 'pc_1', 'confirmed');
      `)
      const store = makeStore(drizzle(database))
      const rows = yield* store.listPieces('ac_1')
      yield* store.deletePieces('ac_1', rows, cascadeReceipt)
      expect(database.sqlite.prepare('select id from pieces').all()).toEqual([{ id: 'pc_3' }])
      for (const table of ['look_pieces', 'board_pins', 'board_items', 'worn_pieces', 'piece_pictures'])
        expect(count(database, `select count(*) from ${table}`)).toBe(0)
      expect(database.sqlite.prepare('select target_id from content_checks').all()).toEqual([{ target_id: 'pc_3' }])
      expect(database.sqlite.prepare('select id, piece_id from photo_garments').all()).toEqual([
        { id: 'pg_1', piece_id: null },
      ])
      expect(count(database, 'select count(*) from looks')).toBe(1)
      expect(count(database, 'select count(*) from boards')).toBe(1)
    }),
  )
})
