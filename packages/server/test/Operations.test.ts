import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, Handle, OperationId } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { BoardStore } from '../src/boards/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { Media } from '../src/kernel/Media.ts'
import { recorded } from '../src/kernel/Receipts.ts'
import { Profiles } from '../src/social/Profiles.ts'
import { PublicPages } from '../src/social/Public.ts'
import { Social } from '../src/social/Social.ts'
import { localD1 } from './LocalD1.ts'
import { passingChecks } from './PassingChecks.ts'

// A write that takes an operation id keeps its promise: the first request writes, a repeat writes nothing and answers
// as the first did, and the same id with other input is OperationConflict. A repeat that wrote again would undo
// whatever the person did in between: publish A, unpublish B, a retry of A must leave the profile unpublished.

/** Ana (handle `ana`, unpublished) and Bob (published), in a fresh database. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_2', 0, 'Bob', 0);
    INSERT INTO profiles (account_id, handle, name, tone, published, house, search_text, created_at, updated_at)
      VALUES ('ac_1', 'ana', 'Ana', 'sand', 0, 0, ' ana', 0, 0), ('ac_2', 'bob', 'Bob', 'sand', 1, 0, ' bob', 0, 0);
  `)
  return database
}

const operation = (id: string) => OperationId.make(`op-${id}-0001`)

/** Profiles and Social over the database, acting for Ana, with a judge that passes everything. */
const services = (database: ReturnType<typeof localD1>) => {
  const checks = passingChecks
  const pages = PublicPages.layer.pipe(Layer.provide(BoardStore.layer))
  return Layer.mergeAll(Profiles.layer, Social.layer).pipe(
    Layer.provide(pages),
    Layer.provideMerge(checks),
    Layer.provideMerge(
      Layer.mergeAll(
        Database.layer(database),
        // SAFETY: the media binding is an empty fake -- no profile or social write reads or stores an object
        Layer.succeed(Media, Media.of({} as never)),
        Layer.succeed(CurrentAccount, CurrentAccount.of({ accountId: 'ac_1', via: 'session' })),
      ),
    ),
  )
}

const receipts = (database: ReturnType<typeof localD1>) =>
  database.sqlite.prepare('SELECT operation_id AS id, command FROM operation_receipts ORDER BY operation_id').all()

describe('a write under an operation id', () => {
  it.effect('publishes once: a late repeat of a publish does not undo the unpublish made since', () => {
    const database = seeded()
    return Effect.gen(function* () {
      const profiles = yield* Profiles
      expect((yield* profiles.publishProfile({ operationId: operation('a'), published: true })).published).toBe(true)
      expect((yield* profiles.publishProfile({ operationId: operation('b'), published: false })).published).toBe(false)
      expect((yield* profiles.publishProfile({ operationId: operation('a'), published: true })).published).toBe(false)
      const conflict = yield* Effect.flip(profiles.publishProfile({ operationId: operation('a'), published: false }))
      expect(conflict).toMatchObject({ _tag: 'OperationConflict' })
      expect(receipts(database)).toEqual([
        { id: operation('a'), command: 'publishProfile' },
        { id: operation('b'), command: 'publishProfile' },
      ])
    }).pipe(Effect.provide(services(database)))
  })

  it.effect('edits a profile once: a repeat answers the profile as it is, another edit under the id conflicts', () => {
    const database = seeded()
    return Effect.gen(function* () {
      const profiles = yield* Profiles
      yield* profiles.updateProfile({ operationId: operation('a'), name: 'Ana Novak' })
      yield* profiles.updateProfile({ operationId: operation('b'), name: 'Ana N.' })
      expect((yield* profiles.updateProfile({ operationId: operation('a'), name: 'Ana Novak' })).name).toBe('Ana N.')
      const conflict = yield* Effect.flip(profiles.updateProfile({ operationId: operation('a'), name: 'Ana' }))
      expect(conflict).toMatchObject({ _tag: 'OperationConflict' })
    }).pipe(Effect.provide(services(database)))
  })

  it.effect('blocks once: a late repeat of a block does not undo the unblock made since', () => {
    const database = seeded()
    const bo = Handle.make('bob')
    return Effect.gen(function* () {
      const social = yield* Social
      yield* social.setBlocked(bo, { operationId: operation('a'), blocked: true })
      yield* social.setBlocked(bo, { operationId: operation('b'), blocked: false })
      yield* social.setBlocked(bo, { operationId: operation('a'), blocked: true })
      expect(database.sqlite.prepare('SELECT blocker_id FROM blocks').all()).toEqual([])
      const conflict = yield* Effect.flip(social.setBlocked(bo, { operationId: operation('a'), blocked: false }))
      expect(conflict).toMatchObject({ _tag: 'OperationConflict' })
    }).pipe(Effect.provide(services(database)))
  })

  it.effect('follows once: a late repeat of a follow does not follow again after an unfollow', () => {
    const database = seeded()
    const bo = Handle.make('bob')
    return Effect.gen(function* () {
      const social = yield* Social
      yield* social.setFollowing(bo, { operationId: operation('a'), following: true })
      yield* social.setFollowing(bo, { operationId: operation('b'), following: false })
      yield* social.setFollowing(bo, { operationId: operation('a'), following: true })
      expect(database.sqlite.prepare('SELECT follower_id FROM follows').all()).toEqual([])
    }).pipe(Effect.provide(services(database)))
  })
})

describe('a recorded write', () => {
  it.effect('answers a request that raced the first from the receipt the first wrote', () => {
    const database = seeded()
    const asked = { accountId: 'ac_1', operationId: 'op-race-0001', command: 'publishProfile', input: true }
    return Effect.gen(function* () {
      const db = yield* Database
      let writes = 0
      const steps = (answer: string) => ({
        write: Effect.sync(() => {
          writes += 1
          return { statements: [], result: answer }
        }),
        answer: (result: string) => Effect.succeed(result),
      })
      // The first request's batch lands while the second is deciding its own: the second's batch fails on the
      // receipt's key and answers what the first made.
      const second = recorded(db, asked, {
        ...steps('second'),
        write: Effect.flatMap(recorded(db, asked, steps('first')), () => steps('second').write),
      })
      expect(yield* second).toBe('first')
      expect(writes).toBe(2)
      expect(receipts(database)).toEqual([{ id: 'op-race-0001', command: 'publishProfile' }])
    }).pipe(Effect.provide(Database.layer(database)))
  })
})
