import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { UserId, OperationId } from '@styld/domain/Identity'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { reserveCommandId, settleCommandId } from '@styld/domain/Wallet/WalletCommandIds'
import { format } from '@styld/i18n'
import { Effect, Layer, Result, Schedule, Schema } from 'effect'
import { Redacted } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { exerciseAttemptLimiter } from './AttemptLimiterFixture.ts'
import { seedIdentity, disableIdentity } from './IdentityFixture.ts'
import { pictureRoutes } from './PictureFixture.ts'
import { mediaLoadRoutes } from './MediaLoadFixture.ts'
import { navigationRoutes } from './NavigationFixture.ts'
import { scanRoutes } from './ScanFixture.ts'
import { recoveryRoutes } from './RecoveryFixture.ts'
import { socialRoutes } from './SocialFixture.ts'
import { makeAuthHttp, withCodeRequestPolicy } from '../src/AuthHttp.ts'
import { authOptions } from '../src/AuthConfiguration.ts'
import { drizzle } from 'drizzle-orm/d1'
import { outfitStore } from '../src/outfits/Store.ts'
import { onFirstUse } from '../src/IsolateCache.ts'
import { DomainLive } from '../src/DomainLive.ts'
import { StyldDatabase, StyldMedia, StyldPieceQueue } from '../src/Resources.ts'

/** Local D1 answers SQLITE_BUSY for a while when another test (or another session's workerd) writes. Each fixture
 * write is one atomic batch, so it is retried on its own until the database is free. */
const whenFree = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  write.pipe(
    // Alchemy's D1 client turns a rejected call, SQLITE_BUSY among them, into a defect: it is tried again too.
    Effect.catchDefect((defect) => Effect.fail(defect)),
    Effect.retry({ times: 60, schedule: Schedule.spaced('200 millis') }),
  )

/** A one-key keyring of the fixture's own. */
const testKeys = (material: string) => ({
  activeKeyId: 'native-test',
  keys: [{ id: 'native-test', material: Redacted.make(material) }],
})

/** The accounts a test asks for. */
const SeedRequest = Schema.Struct({ ids: Schema.Array(Schema.String) })

/** A fixture write retried while the database is busy, answered with 204. */
const doneWhenFree = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  whenFree(write).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 })))
import { importRoutes } from './ImportFixture.ts'
import { storageHealth } from './StorageHealth.ts'

// The server formats in every language: page renders and code emails.
provideAllCatalogs()

// Only the local native-test stack imports this fixture. It has no production declaration.
export default class RuntimeWorker extends Cloudflare.Worker<RuntimeWorker>()(
  'RuntimeWorker',
  {
    main: import.meta.url,
    compatibility: { date: '2026-10-19' },
  },
  // oxlint-disable-next-line max-lines-per-function -- native acceptance fixture keeps all endpoints in one Worker.
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
    // The API Worker's work queue, to hand the match job the scan fixture's sightings.
    const pieceQueue = yield* Cloudflare.Queues.WriteQueue(yield* StyldPieceQueue)
    const auth = makeAuthHttp(
      database,
      authOptions(
        {
          origin: 'http://localhost',
          secret: Redacted.make('native-test-auth-secret-012345678901234567890123'),
          sessionKeys: testKeys('bmF0aXZlLXRlc3Qta2V5LW1hdGVyaWFsLWxvbmc='),
          proofKeys: testKeys('b'.repeat(43)),
          requestBindingKeys: testKeys('c'.repeat(43)),
        },
        // The fixture seeds password identities only; a code request here is a test bug.
        { send: () => Promise.reject(new Error('the runtime fixture sends no email')) },
        'Styld <noreply@styld.test>',
      ),
    )
    const identityRoutes = Layer.mergeAll(
      auth.layer,
      yield* recoveryRoutes(database, media),
      pictureRoutes(database, media),
      mediaLoadRoutes(database, media),
      navigationRoutes(database, media),
      scanRoutes(database, media, yield* pieceQueue.raw),
      socialRoutes(database, media),
      importRoutes(database, media),
      // Accounts for a test: `{ ids }`, each with a verified email and the test password (test/Accounts.ts).
      HttpRouter.add(
        'POST',
        '/test/identity/seed',
        Effect.gen(function* () {
          const { ids } = yield* Effect.flatMap(
            (yield* HttpServerRequest).json,
            Schema.decodeUnknownEffect(SeedRequest),
          )
          yield* Effect.forEach(ids, (id) => whenFree(seedIdentity(database, id)))
          return HttpServerResponse.empty({ status: 204 })
        }).pipe(Effect.orDie),
      ),
      // Thinking's daily cap on real D1, at two a day: two counted, the third refused, the next day counted again.
      HttpRouter.add(
        'POST',
        '/test/identity/thinking-cap',
        Effect.gen(function* () {
          const days = outfitStore(drizzle(yield* database.raw))
          const count = (day: string) => whenFree(days.countThinking('native-outfits-other', day, 2))
          const counted = [
            yield* count('2026-10-30'),
            yield* count('2026-10-30'),
            yield* count('2026-10-30'),
            yield* count('2026-10-31'),
          ]
          yield* whenFree(days.sweepBefore('2026-10-31'))
          return yield* HttpServerResponse.json({ counted, afterSweep: yield* count('2026-10-30') })
        }).pipe(Effect.orDie),
      ),
      // Whether a stored photo still exists, to prove deletion removes it.
      HttpRouter.add(
        'GET',
        '/test/identity/media',
        Effect.gen(function* () {
          const request = yield* HttpServerRequest
          const key = new URL(request.url, 'http://local.invalid').searchParams.get('key') ?? ''
          const object = yield* media.head(key).pipe(Effect.orDie)
          return yield* HttpServerResponse.json({ exists: object !== null }).pipe(Effect.orDie)
        }),
      ),
      // A stored object's bytes, to check what the browser actually sent.
      HttpRouter.add(
        'GET',
        '/test/identity/media-bytes',
        Effect.gen(function* () {
          const request = yield* HttpServerRequest
          const key = new URL(request.url, 'http://local.invalid').searchParams.get('key') ?? ''
          const object = yield* media.get(key).pipe(Effect.orDie)
          if (object === null) return HttpServerResponse.empty({ status: 404 })
          return HttpServerResponse.uint8Array(new Uint8Array(yield* object.arrayBuffer().pipe(Effect.orDie)))
        }),
      ),
      HttpRouter.add(
        'POST',
        '/test/identity/disable',
        disableIdentity(database).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
      ),
      HttpRouter.add('POST', '/test/identity/disable-mcp', doneWhenFree(disableIdentity(database, 'native-mcp'))),
      HttpRouter.add(
        'POST',
        '/test/identity/limits',
        exerciseAttemptLimiter(database).pipe(Effect.orDie, Effect.flatMap(HttpServerResponse.json)),
      ),
    )
    // Built on the first request, like the API Worker: auth validates its tables against D1, which
    // Alchemy migrates only after it has evaluated this constructor.
    const authHandle = yield* onFirstUse(() =>
      HttpRouter.toHttpEffect(identityRoutes.pipe(Layer.provide(AlchemyHttp.Platform))).pipe(Effect.orDie),
    )
    const wallets = yield* Wallet
    const exercise = Effect.fn('Styld.acceptance.wallet')(function* () {
      const owner = UserId.make('native-test-owner')
      const compete = (id: string) => {
        // Two holds of 8 out of a day's 10: only one fits, if the Wallet serializes them.
        const command = new ReserveCredits({
          operationId: OperationId.make(id),
          amount: 8,
          day: '2026-10-29',
          dailyAllowance: 10,
        })
        return wallets.send(owner, command, { commandId: reserveCommandId(command) }).pipe(Effect.result)
      }
      const results = yield* Effect.all([compete('one'), compete('two')], { concurrency: 'unbounded' })
      const reserved = yield* wallets.state(owner)
      const operationId = Object.keys(reserved.reservations)[0]
      if (operationId !== undefined) {
        const refund = new SettleCredits({ operationId: OperationId.make(operationId), outcome: 'refunded' })
        yield* wallets.send(owner, refund, { commandId: settleCommandId(refund) })
        yield* compete(operationId)
      }
      const settled = yield* wallets.state(owner)
      const other = yield* wallets.state(UserId.make('native-test-other'))
      return { successful: results.filter(Result.isSuccess).length, reserved, settled, other }
    })
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const url = new URL(request.url, 'http://local.invalid')
        if (
          url.pathname.startsWith('/api/auth/') ||
          url.pathname.startsWith('/test/identity/') ||
          url.pathname.startsWith('/test/recovery/') ||
          url.pathname.startsWith('/test/pictures/') ||
          url.pathname.startsWith('/test/scan/') ||
          url.pathname.startsWith('/test/social/') ||
          url.pathname.startsWith('/test/imports/')
        )
          // The fixture sends no codes; its auth still needs the per-request code policy.
          return yield* (yield* authHandle(undefined)).pipe(
            withCodeRequestPolicy(request.headers, () => Effect.succeed(true)),
          )
        if (url.pathname === '/intl')
          return yield* HttpServerResponse.json({
            en: format('en', 'looks.pieceCount', { count: 2 }),
            sl: format('sl', 'looks.pieceCount', { count: 102 }),
            plural: new Intl.PluralRules('sl').select(2),
            date: new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric' }).format(0),
            currency: new Intl.NumberFormat('sl', { style: 'currency', currency: 'EUR' }).format(12.5),
          })
        if (url.pathname === '/wallet')
          return yield* exercise().pipe(
            Effect.orDie,
            Effect.flatMap((payload) => HttpServerResponse.json(payload).pipe(Effect.orDie)),
          )
        if (url.pathname === '/storage') return yield* storageHealth(database, media)
        return HttpServerResponse.empty({ status: 404 })
      }),
    }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.effect(RuntimeContext, Cloudflare.Worker),
        DomainLive,
        Cloudflare.Telemetry(),
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.WriteQueueBinding,
      ),
    ),
  ),
) {}
