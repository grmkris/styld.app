import { CurrentAccount } from '@styld/protocol'
import { Effect, Option, Redacted } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  expiryOf,
  type MediaGrant,
  mediaKey,
  type Presented,
  SignedMedia,
  signGrant,
  verifyGrant,
} from '../src/kernel/SignedMedia.ts'

const secret = Redacted.make('a'.repeat(32))
const grant: MediaGrant = {
  accountId: 'acc_1',
  entityId: 'pc_1',
  key: 'accounts/acc_1/uploads/up_1',
  contentType: 'image/jpeg',
  variant: 'thumb',
  version: '1700000000000.photo0',
}
const now = Date.UTC(2026, 10, 2, 10, 30)
const hour = 60 * 60 * 1000

/** What a request would present for an address: its path's entity and variant, and its query. */
const presented = (address: string): Presented => {
  const url = new URL(address, 'https://styld.test')
  const [, , , entityId = '', variant = ''] = url.pathname.split('/')
  return {
    entityId: decodeURIComponent(entityId),
    variant: decodeURIComponent(variant),
    query: Object.fromEntries(url.searchParams),
  }
}

const signed = (key: CryptoKey, at = now, of: MediaGrant = grant) => signGrant(key, { ...of, expires: expiryOf(at) })

/** A presented address with one query field replaced. */
const altered = (address: string, field: string, value: string) => {
  const shown = presented(address)
  return { ...shown, query: { ...shown.query, [field]: value } }
}

describe('signed media addresses', () => {
  test('name the grant they were signed for until they expire, the same address for an hour', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const key = yield* mediaKey(secret)
        const address = yield* signed(key)
        expect(address.startsWith('/cdn/media/pc_1/thumb?')).toBe(true)
        expect(yield* signed(key, now + 20 * 60 * 1000)).toBe(address)
        const found = yield* verifyGrant(key, presented(address), now)
        expect(Option.map(found, ({ key: objectKey, accountId }) => [objectKey, accountId])).toEqual(
          Option.some([grant.key, grant.accountId]),
        )
        // Good for at least a day, and not past its rounded hour.
        expect(Option.isSome(yield* verifyGrant(key, presented(address), now + 24 * hour))).toBe(true)
        expect(yield* verifyGrant(key, presented(address), now + 25 * hour)).toEqual(Option.none())
      }),
    ))

  test('refuse an altered field, another account, another size, another secret or no signature', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const key = yield* mediaKey(secret)
        const address = yield* signed(key)
        const refused = (shown: Presented) => Effect.map(verifyGrant(key, shown, now), Option.isNone)
        expect(yield* refused(altered(address, 'k', 'accounts/acc_1/uploads/up_2'))).toBe(true)
        expect(yield* refused(altered(address, 'a', 'acc_2'))).toBe(true)
        // Another account's key under its own account id is still not what was signed.
        const moved = altered(address, 'a', 'acc_2')
        expect(yield* refused({ ...moved, query: { ...moved.query, k: 'accounts/acc_2/uploads/up_1' } })).toBe(true)
        expect(yield* refused(altered(address, 't', 'image/png'))).toBe(true)
        expect(yield* refused(altered(address, 'v', 'later'))).toBe(true)
        expect(yield* refused(altered(address, 'e', String(expiryOf(now) + 3600)))).toBe(true)
        expect(yield* refused({ ...presented(address), variant: 'full' })).toBe(true)
        expect(yield* refused({ ...presented(address), entityId: 'pc_2' })).toBe(true)
        expect(yield* refused(altered(address, 's', 'AAAA'))).toBe(true)
        expect(yield* refused(altered(address, 's', '!'))).toBe(true)
        const { s: _signature, ...unsigned } = presented(address).query
        expect(yield* refused({ ...presented(address), query: unsigned })).toBe(true)
        const otherKey = yield* mediaKey(Redacted.make('b'.repeat(32)))
        expect(Option.isNone(yield* verifyGrant(otherKey, presented(address), now))).toBe(true)
      }),
    ))

  test('refuse a key outside the account it names, even signed', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const key = yield* mediaKey(secret)
        const address = yield* signed(key, now, { ...grant, key: 'accounts/acc_2/uploads/up_1' })
        expect(yield* verifyGrant(key, presented(address), now)).toEqual(Option.none())
      }),
    ))

  test('are handed to the website only, never to an assistant', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const media = yield* SignedMedia
        const { accountId: _account, ...rest } = grant
        const forSession = yield* media
          .address(rest)
          .pipe(Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'session' })))
        const forAssistant = yield* media
          .address(rest)
          .pipe(Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })))
        expect(Option.isSome(forSession)).toBe(true)
        expect(forAssistant).toEqual(Option.none())
        const verified = yield* media.verify(presented(Option.getOrElse(forSession, () => '')))
        expect(Option.map(verified, ({ accountId }) => accountId)).toEqual(Option.some('acc_1'))
      }).pipe(Effect.provide(SignedMedia.layer(secret))),
    ))
})
