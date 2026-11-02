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
      VALUES ('pc_1', 'ac_1', 'tops', '[]', '[]', 'ready', 'website', 'ac_1/pc_1.jpg', 'image/jpeg', 0, 0);
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
  target: string,
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
    const other = yield* Effect.exit(deleting(receipts, { ...deletion, target: `${target}-other` }, once))
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
        store.deletePiece('ac_1', piece, receipt),
      )
      expect(removed).toBe(1)
      expect(conflict(other)).toBe(true)
      expect(count(database, 'select count(*) from pieces')).toBe(0)
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
