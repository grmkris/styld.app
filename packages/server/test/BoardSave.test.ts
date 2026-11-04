import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { BoardStore, type TableSave } from '../src/boards/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { localD1 } from './LocalD1.ts'

// Two editors save a board's table from the same version at once: one lands, the other learns the new version. Since
// receipts may be pending (a null result, 2 November), a lost save of an empty table wrote no item and failed nothing,
// so it left a pending receipt behind and the editor was told Styld was unavailable instead of the board's version.

const saveFrom = (operationId: string, version: number): TableSave => ({
  accountId: 'ac_1',
  boardId: 'bd_1',
  version,
  items: [],
  pins: [],
  receipt: {
    accountId: 'ac_1',
    operationId,
    command: 'saveBoardItems',
    inputDigest: operationId,
    result: 'bd_1',
    createdAt: new Date(5),
  },
  at: new Date(5),
})

const board = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Eva', 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at)
      VALUES ('bd_1', 'ac_1', 'Autumn', 'paper', 3, 'private', '[]', '', 0, 0);
  `)
  const receipts = () =>
    database.sqlite.prepare('SELECT operation_id AS id, result FROM operation_receipts ORDER BY operation_id').all()
  return { receipts, layer: BoardStore.layer.pipe(Layer.provide(Database.layer(database))) }
}

describe("a board's table saved from a version", () => {
  const { receipts, layer } = board()
  it.effect('lands once, and an empty table that lost the race writes nothing, its receipt included', () =>
    Effect.gen(function* () {
      const store = yield* BoardStore
      expect(yield* store.saveItems(saveFrom('op_won', 3))).toEqual(Option.some({ version: 4 }))
      const lost = yield* store.saveItems(saveFrom('op_lost', 3)).pipe(Effect.option)
      expect(Option.flatten(lost)).toEqual(Option.none())
      expect(receipts()).toEqual([{ id: 'op_won', result: 'bd_1' }])
    }).pipe(Effect.provide(layer)),
  )
})
