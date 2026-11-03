import * as Cloudflare from '@alchemy.run/cloudflare'
import { OperationId, UserId } from '@styld/domain/Identity'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { reserveCommandId, settleCommandId } from '@styld/domain/Wallet/WalletCommandIds'
import { dailyCredits } from '@styld/protocol'
import { DateTime, Effect, Schema } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { Runtime, styldProgram, workerOptions } from '../src/StyldWorker.ts'
import { nativeProviders } from './fakes/Providers.ts'

// The API Worker as the native suite runs it: the same program on the fakes' providers, and one route of its own that
// spends an account's credits down, so a journey can reach the daily limit without paying its way there. Only the
// local native-test stack declares it.

const Spend = Schema.Struct({ accountId: Schema.String, leave: Schema.Int })

export class NativeWorker extends Cloudflare.Worker<NativeWorker, Cloudflare.WorkerShape>()('NativeWorker') {}

export default NativeWorker.make(
  workerOptions(import.meta.url),
  Effect.gen(function* () {
    const { fetch, ...rpc } = yield* styldProgram(nativeProviders)
    const wallets = yield* Wallet
    /** Spend all but `leave` of the account's credits today, consumed at once. */
    const spend = Effect.gen(function* () {
      const { accountId, leave } = yield* Effect.flatMap(
        (yield* HttpServerRequest).json,
        Schema.decodeUnknownEffect(Spend),
      )
      const account = UserId.make(accountId)
      const day = DateTime.formatIsoDateUtc(yield* DateTime.now)
      const state = yield* wallets.state(account)
      const left = state.daily.day === day ? state.daily.remaining : dailyCredits
      const operationId = OperationId.make(`native-spend/${accountId}/${day}/${left}`)
      const reserve = new ReserveCredits({ operationId, amount: left - leave, day, dailyAllowance: dailyCredits })
      yield* wallets.send(account, reserve, { commandId: reserveCommandId(reserve) })
      const consume = new SettleCredits({ operationId, outcome: 'consumed' })
      yield* wallets.send(account, consume, { commandId: settleCommandId(consume) })
      return HttpServerResponse.empty({ status: 204 })
    }).pipe(Effect.orDie)
    return {
      ...rpc,
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        return new URL(request.url, 'http://local.invalid').pathname === '/api/native/spend'
          ? yield* spend
          : yield* fetch
      }),
    }
  }).pipe(Effect.provide(Runtime)),
)
