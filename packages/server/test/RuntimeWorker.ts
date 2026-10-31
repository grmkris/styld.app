import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import { CurrentActor } from '@styld/domain/CurrentActor.context'
import { UserId, OperationId } from '@styld/domain/Identity'
import { GrantMonthlyCredits } from '@styld/domain/Wallet/GrantMonthlyCredits.command'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { monthlyGrantCommandId, reserveCommandId, settleCommandId } from '@styld/domain/Wallet/WalletCommandIds'
import { format } from '@styld/i18n'
import { Effect, Layer, Result, Schedule } from 'effect'
import { Redacted } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { exerciseAttemptLimiter } from './AttemptLimiterFixture.ts'
import { seedIdentity, disableIdentity } from './IdentityFixture.ts'
import { pictureRoutes } from './PictureFixture.ts'
import { scanRoutes } from './ScanFixture.ts'
import { recoveryRoutes } from './RecoveryFixture.ts'
import { socialRoutes } from './SocialFixture.ts'
import { makeAuthHttp, withCodeRequestPolicy } from '../src/AuthHttp.ts'
import { onFirstUse } from '../src/IsolateCache.ts'
import { DomainLive } from '../src/DomainLive.ts'
import { StyldDatabase, StyldMedia, StyldPieceQueue } from '../src/Resources.ts'

/** Local D1 answers SQLITE_BUSY for a while when another test (or another session's workerd) writes. Each fixture
 * write is one atomic batch, so it is retried on its own until the database is free. */
const whenFree = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  write.pipe(Effect.retry({ times: 60, schedule: Schedule.spaced('200 millis') }))

/** A fixture write retried while the database is busy, answered with 204. */
const doneWhenFree = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  whenFree(write).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 })))
import { storageHealth } from './StorageHealth.ts'

// The server formats in every language: page renders and code emails.
provideAllCatalogs()

// Only the local native-test stack imports this fixture. It has no production declaration.
export default class RuntimeWorker extends Cloudflare.Worker<RuntimeWorker>()(
  'RuntimeWorker',
  {
    main: import.meta.url,
    compatibility: { date: '2026-10-19' },
    env: {
      STYLD_ENV: 'local',
      STYLD_RELEASE: 'native-test',
      AUTH_ORIGIN: 'http://localhost',
      AUTH_SECRET: 'native-test-auth-secret-012345678901234567890123',
      AUTH_SESSION_KEYS: JSON.stringify({
        activeKeyId: 'native-test',
        keys: [{ id: 'native-test', material: 'bmF0aXZlLXRlc3Qta2V5LW1hdGVyaWFsLWxvbmc=' }],
      }),
    },
  },
  // oxlint-disable-next-line max-lines-per-function -- native acceptance fixture keeps all endpoints in one Worker.
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
    // The API Worker's work queue, to hand the match job the scan fixture's sightings.
    const pieceQueue = yield* Cloudflare.Queues.WriteQueue(yield* StyldPieceQueue)
    const auth = makeAuthHttp(database, {
      origin: 'http://localhost',
      secret: Redacted.make('native-test-auth-secret-012345678901234567890123'),
      secureCookies: false,
      sessionKeys: {
        activeKeyId: 'native-test',
        keys: [{ id: 'native-test', material: Redacted.make('bmF0aXZlLXRlc3Qta2V5LW1hdGVyaWFsLWxvbmc=') }],
      },
      // The fixture seeds password identities only; a code request here is a test bug.
      email: {
        sender: { send: () => Promise.reject(new Error('the runtime fixture sends no email')) },
        from: 'Styld <noreply@styld.test>',
        proofKeys: {
          activeKeyId: 'native-test',
          keys: [{ id: 'native-test', material: Redacted.make('b'.repeat(43)) }],
        },
        requestBindingKeys: {
          activeKeyId: 'native-test',
          keys: [{ id: 'native-test', material: Redacted.make('c'.repeat(43)) }],
        },
        returnTargets: ['/'],
      },
    })
    const identityRoutes = Layer.mergeAll(
      auth.layer,
      yield* recoveryRoutes(database, media),
      pictureRoutes(database, media),
      scanRoutes(database, media, yield* pieceQueue.raw),
      socialRoutes(database, media),
      HttpRouter.add(
        'POST',
        '/test/identity/seed',
        seedIdentity(database).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
      ),
      HttpRouter.add(
        'POST',
        '/test/identity/seed-limited',
        seedIdentity(database, 'native-limited').pipe(
          Effect.orDie,
          Effect.as(HttpServerResponse.empty({ status: 204 })),
        ),
      ),
      // An owner and a second account for the wardrobe's isolation checks.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-wardrobe',
        doneWhenFree(
          Effect.forEach(['native-wardrobe', 'native-wardrobe-other', 'native-farewell'], (id) =>
            whenFree(seedIdentity(database, id)),
          ),
        ),
      ),
      // An owner and a second account for the capture tray's isolation and allowance checks.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-capture',
        doneWhenFree(
          Effect.forEach(['native-capture', 'native-capture-other'], (id) => whenFree(seedIdentity(database, id))),
        ),
      ),
      // An owner and a second account for the boards', worn days' and website looks' isolation checks.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-boards',
        doneWhenFree(
          Effect.forEach(['native-boards', 'native-boards-other'], (id) => whenFree(seedIdentity(database, id))),
        ),
      ),
      // Two people for profiles, public boards and what others may see.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-social',
        doneWhenFree(
          Effect.forEach(
            ['native-social', 'native-social-other', 'native-social-third', 'native-social-fourth'],
            (id) => whenFree(seedIdentity(database, id)),
          ),
        ),
      ),
      // An owner and a second account for generated pictures and mood boards.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-generation',
        doneWhenFree(
          Effect.forEach(['native-generation', 'native-generation-other'], (id) =>
            whenFree(seedIdentity(database, id)),
          ),
        ),
      ),
      // The person whose profile and public board a signed-out browser visits.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-social-browser',
        doneWhenFree(seedIdentity(database, 'native-social-browser')),
      ),
      // The account the browser's Gallery 2 journey (Home, boards, Ask) signs in as.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-gallery-browser',
        doneWhenFree(seedIdentity(database, 'native-gallery-browser')),
      ),
      // The account the browser's capture journey signs in as.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-capture-browser',
        doneWhenFree(seedIdentity(database, 'native-capture-browser')),
      ),
      // The account the browser's camera journey signs in as.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-camera-browser',
        doneWhenFree(seedIdentity(database, 'native-camera-browser')),
      ),
      // The account the browser's long-video journey signs in as.
      HttpRouter.add(
        'POST',
        '/test/identity/seed-video-browser',
        doneWhenFree(seedIdentity(database, 'native-video-browser')),
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
      HttpRouter.add(
        'POST',
        '/test/identity/seed-mcp',
        seedIdentity(database, 'native-mcp').pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
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
    const authHandle = yield* onFirstUse(() => HttpRouter.toHttpEffect(identityRoutes).pipe(Effect.orDie))
    const wallets = yield* Wallet
    const exercise = Effect.fn('Styld.acceptance.wallet')(function* () {
      const owner = UserId.make('native-test-owner')
      const grant = new GrantMonthlyCredits({ period: '2026-10', monthly: 10 })
      yield* wallets.send(owner, grant, { commandId: monthlyGrantCommandId(grant) })
      const compete = (id: string) => {
        const command = new ReserveCredits({
          operationId: OperationId.make(id),
          fingerprint: 'a'.repeat(64),
          amount: 8,
          // No free allowance here: this fixture proves the subscription pool serializes reservations.
          day: '2026-10-29',
          dailyAllowance: 0,
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
          url.pathname.startsWith('/test/social/')
        )
          // The fixture sends no codes; its auth still needs the per-request code policy.
          return yield* (yield* authHandle(undefined)).pipe(
            withCodeRequestPolicy(request.headers, () => Effect.succeed(true)),
          )
        if (url.pathname === '/intl')
          return yield* HttpServerResponse.json({
            en: format('en', 'catalog.pieces', { count: 2 }),
            sl: format('sl', 'catalog.pieces', { count: 102 }),
            plural: new Intl.PluralRules('sl').select(2),
            date: new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric' }).format(0),
            currency: new Intl.NumberFormat('sl', { style: 'currency', currency: 'EUR' }).format(12.5),
          })
        if (url.pathname === '/wallet')
          return yield* exercise().pipe(
            Effect.provideService(CurrentActor, { userId: UserId.make('native-test-owner'), service: true }),
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
        DomainLive,
        Cloudflare.Telemetry(),
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.WriteQueueBinding,
      ),
    ),
  ),
) {}
