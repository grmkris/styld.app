import { describe, expect, it } from '@effect/vitest'
import { pieces } from '@styld/db'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { CurrentAccount } from '@styld/protocol'
import { Effect, Exit, Layer, Record, Schema } from 'effect'
import { Database, query } from '../src/kernel/Db.ts'
import { Pacing } from '../src/kernel/Pacing.ts'
import { paces } from '../src/kernel/Paces.ts'
import { admitUpload } from '../src/wardrobe/Admission.ts'
import { keysInUse, spendUpload, WardrobeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'

/** A database with one account and one received upload. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  database.sqlite.exec(
    `INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
     VALUES ('up_1', 'ac_1', 'd', 'image/png', 1, 'k/up_1', 'received', 0)`,
  )
  return database
}

const status = (database: ReturnType<typeof seeded>) =>
  Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }))(
    database.sqlite.prepare("SELECT status FROM uploads WHERE id = 'up_1'").get(),
  ).status

describe('one upload makes one thing', () => {
  it.effect('a received upload is spent once; spending it again fails the whole batch, which writes nothing', () =>
    Effect.gen(function* () {
      const database = seeded()
      const db = drizzle(database)
      yield* query(() => db.batch([spendUpload(db, 'up_1')]))
      expect(status(database)).toBe('used')
      // A back and a capture racing for the same upload: the second batch fails whole, its piece row with it.
      const second = yield* Effect.exit(
        query(() =>
          db.batch([db.update(pieces).set({ name: 'never' }).where(eq(pieces.id, 'pc_none')), spendUpload(db, 'up_1')]),
        ),
      )
      expect(Exit.isFailure(second)).toBe(true)
      expect(status(database)).toBe('used')
    }),
  )

  it.effect('an upload not yet received cannot be spent', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec("UPDATE uploads SET status = 'pending'")
      const db = drizzle(database)
      expect(Exit.isFailure(yield* Effect.exit(query(() => db.batch([spendUpload(db, 'up_1')]))))).toBe(true)
      expect(status(database)).toBe('pending')
    }),
  )
})

describe('the one in-use check', () => {
  it.effect('a key a piece shows, or an open tray card shows, is in use; a discarded card is not', () =>
    Effect.gen(function* () {
      const database = seeded()
      database.sqlite.exec(
        `INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key, back_image_key, content_type, created_at, updated_at)
         VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k/photo', 'k/cutout', NULL, 'image/png', 0, 0)`,
      )
      database.sqlite.exec(
        `INSERT INTO captures (id, account_id, kind, source, status, upload_id, original_key, content_type, bytes, credits, attempt, created_at, updated_at)
         VALUES ('cp_1', 'ac_1', 'photo', 'picker', 'review', 'up_1', 'k/tray', 'image/png', 1, 1, 0, 0, 0)`,
      )
      database.sqlite.exec(
        `INSERT INTO detections (id, capture_id, account_id, status, cutout_key, source_key, preselected, suggested_colours, suggested_occasions, created_at)
         VALUES ('dt_1', 'cp_1', 'ac_1', 'review', 'k/open', 'k/tray', 1, '[]', '[]', 0),
                ('dt_2', 'cp_1', 'ac_1', 'discarded', 'k/discarded', 'k/tray', 0, '[]', '[]', 0)`,
      )
      const keys = ['k/photo', 'k/cutout', 'k/open', 'k/tray', 'k/discarded', 'k/gone']
      const inUse = yield* keysInUse(drizzle(database), 'ac_1', keys)
      expect([...inUse].filter((key) => keys.includes(key)).toSorted()).toEqual([
        'k/cutout',
        'k/open',
        'k/photo',
        'k/tray',
      ])
      expect((yield* keysInUse(drizzle(database), 'ac_2', keys)).size).toBe(0)
    }),
  )
})

/** The account's admission over a database where `waiting` uploads of `bytes` each wait unused. */
const admission = (waiting: number, bytes: number, allowed = 300) => {
  const database = seeded()
  for (let index = 0; index < waiting; index += 1)
    database.sqlite.exec(
      `INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
       VALUES ('up_w${index}', 'ac_1', 'd', 'video/mp4', ${bytes}, 'k/w${index}', 'pending', ${Date.now() + 60_000})`,
    )
  let asked = 0
  const limiter = { limit: async () => ({ success: (asked += 1) <= allowed }) }
  return Layer.mergeAll(
    WardrobeStore.layer.pipe(Layer.provide(Database.layer(database))),
    Pacing.layer(Record.map(paces, () => limiter)),
    Layer.succeed(CurrentAccount, { accountId: 'ac_1', via: 'session' }),
  )
}

describe('handing out upload paths', () => {
  const megabytes = 1024 * 1024

  it.live('admits paths while what waits unused stays under the cap', () =>
    admitUpload(95 * megabytes).pipe(Effect.provide(admission(4, 95 * megabytes))),
  )

  it.live('refuses one more path past the waiting bytes or count, and past the pace', () =>
    Effect.gen(function* () {
      const bytes = yield* Effect.flip(admitUpload(95 * megabytes).pipe(Effect.provide(admission(5, 95 * megabytes))))
      const count = yield* Effect.flip(admitUpload(1).pipe(Effect.provide(admission(100, 1))))
      const paced = yield* Effect.flip(admitUpload(1).pipe(Effect.provide(admission(0, 1, 0))))
      expect([bytes, count, paced]).toMatchObject([
        { _tag: 'LimitReached', limit: 'uploads' },
        { _tag: 'LimitReached', limit: 'uploads' },
        { _tag: 'SlowDown' },
      ])
    }),
  )
})
