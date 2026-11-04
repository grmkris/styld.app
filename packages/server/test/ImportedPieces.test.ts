import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Exit } from 'effect'
import { importedRows } from '../src/imports/Imported.ts'
import { copyRows } from '../src/imports/Copies.ts'
import { forgetOldReceipts } from '../src/kernel/Receipts.ts'
import type { PieceRow, UploadRow } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

// A v1 piece is imported into an account once, whichever bundle carries it and however long after: the mapping is its
// own row, written with the piece, not an operation receipt the sweep forgets after thirty days.

const at = new Date(0)

const rowsFor = (id: string) => {
  const upload: UploadRow = {
    id: `up_${id}`,
    accountId: 'ac_1',
    tokenDigest: 'digest',
    contentType: 'image/jpeg',
    bytes: 3,
    objectKey: `accounts/ac_1/uploads/up_${id}`,
    status: 'used',
    expiresAt: at,
  }
  const piece: PieceRow = {
    id: `pc_${id}`,
    accountId: 'ac_1',
    name: null,
    notes: null,
    type: 'shortSleeveTops',
    colours: [],
    seasons: [],
    rainproof: false,
    category: null,
    occasions: [],
    pattern: null,
    brand: null,
    shopUrl: null,
    status: 'processing',
    source: 'import',
    uploadId: upload.id,
    detectionId: null,
    backImageKey: null,
    rotation: 0,
    originalKey: upload.objectKey,
    imageKey: null,
    contentType: 'image/jpeg',
    createdAt: at,
    updatedAt: at,
  }
  return { upload, piece }
}

const over = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0)",
  )
  return { db: drizzle(database), database }
}

describe('an imported v1 piece', () => {
  for (const fence of ['disabled account', 'discarding copy'] as const)
    it.effect(`cannot adopt a copy after ${fence}`, () => {
      const { db, database } = over()
      return Effect.gen(function* () {
        const first = rowsFor('a')
        yield* copyRows(db).beginCopy(first.upload.objectKey, 'ac_1', at)
        if (fence === 'disabled account') database.sqlite.exec('UPDATE accounts SET enabled = 0')
        else database.sqlite.exec("UPDATE import_copies SET state = 'discarding'")
        expect(
          Exit.isFailure(
            yield* Effect.exit(importedRows(db).createPiece(first.upload, first.piece, 'v1-a', undefined)),
          ),
        ).toBe(true)
        expect(database.sqlite.prepare('SELECT count(*) AS pieces FROM pieces').get()).toEqual({ pieces: 0 })
        expect(database.sqlite.prepare('SELECT count(*) AS copies FROM import_copies').get()).toEqual({ copies: 1 })
      })
    })

  it.effect('a house garment the seed generated is recorded as generated with its piece, in the same batch', () => {
    const { db, database } = over()
    return Effect.gen(function* () {
      const made = rowsFor('g')
      yield* copyRows(db).beginCopy(made.upload.objectKey, 'ac_1', at)
      const generated = {
        manifestId: 'w-knitwear-beige',
        model: 'muse-image-1.0' as const,
        promptDigest: 'a'.repeat(64),
      }
      yield* importedRows(db).createPiece(made.upload, made.piece, 'seed:w-knitwear-beige', generated)
      expect(
        database.sqlite
          .prepare('SELECT piece_id, origin, manifest_id, model, prompt_digest FROM piece_provenance')
          .all(),
      ).toEqual([
        {
          piece_id: 'pc_g',
          origin: 'generated',
          manifest_id: 'w-knitwear-beige',
          model: 'muse-image-1.0',
          prompt_digest: 'a'.repeat(64),
        },
      ])
    })
  })

  it.effect('becomes one piece of the account, however often and however late it is imported', () => {
    const { db, database } = over()
    return Effect.gen(function* () {
      const store = importedRows(db)
      const first = rowsFor('a')
      yield* copyRows(db).beginCopy(first.upload.objectKey, 'ac_1', at)
      yield* store.createPiece(first.upload, first.piece, 'v1-a', undefined)
      expect(database.sqlite.prepare('SELECT count(*) AS copies FROM import_copies').get()).toEqual({ copies: 0 })
      // A second bundle with the same v1 piece, long after every receipt was swept.
      yield* forgetOldReceipts(db, 500)
      const again = rowsFor('b')
      yield* copyRows(db).beginCopy(again.upload.objectKey, 'ac_1', at)
      expect(Exit.isFailure(yield* Effect.exit(store.createPiece(again.upload, again.piece, 'v1-a', undefined)))).toBe(
        true,
      )
      expect(yield* store.importedOf('ac_1', ['v1-a', 'v1-z'])).toEqual([{ v1Id: 'v1-a', pieceId: 'pc_a' }])
      expect(database.sqlite.prepare('SELECT count(*) AS pieces FROM pieces').get()).toEqual({ pieces: 1 })
    })
  })
})
