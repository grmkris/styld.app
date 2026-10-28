import * as Cloudflare from '@alchemy.run/cloudflare'
import { CurrentActor } from '@styld/domain/CurrentActor.context'
import { UserId, OperationId } from '@styld/domain/Identity'
import { GrantMonthlyCredits } from '@styld/domain/Wallet/GrantMonthlyCredits.command'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { format } from '@styld/i18n'
import { Effect, Layer, Result } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { DomainLive } from '../src/DomainLive.ts'

// Only the local native-test stack imports this fixture. It has no production declaration.
export default class RuntimeWorker extends Cloudflare.Worker<RuntimeWorker>()(
  'RuntimeWorker',
  {
    main: import.meta.url,
    compatibility: { date: '2026-10-19' },
  },
  Effect.gen(function* () {
    const wallets = yield* Wallet
    const exercise = Effect.fn('Styld.acceptance.wallet')(function* () {
      const owner = UserId.make('native-test-owner')
      yield* wallets.send(owner, new GrantMonthlyCredits({ period: '2026-10', monthly: 10 }), {
        commandId: 'grant:2026-10',
      })
      const compete = (id: string) =>
        wallets
          .send(
            owner,
            new ReserveCredits({
              operationId: OperationId.make(id),
              fingerprint: 'a'.repeat(64),
              amount: 8,
            }),
            { commandId: `reserve:${id}` },
          )
          .pipe(Effect.result)
      const results = yield* Effect.all([compete('one'), compete('two')], { concurrency: 'unbounded' })
      const reserved = yield* wallets.state(owner)
      const operationId = Object.keys(reserved.reservations)[0]
      if (operationId !== undefined) {
        yield* wallets.send(
          owner,
          new SettleCredits({ operationId: OperationId.make(operationId), outcome: 'refunded' }),
          { commandId: 'settle' },
        )
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
        return HttpServerResponse.empty({ status: 404 })
      }),
    }
  }).pipe(Effect.provide(Layer.mergeAll(DomainLive, Cloudflare.Telemetry()))),
) {}
