import { expect } from 'bun:test'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import * as Test from 'alchemy/Test/Bun'
import { Effect } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import RuntimeWorker from './RuntimeWorker.ts'

const Stack = Alchemy.Stack(
  'StyldLocalAcceptance',
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* RuntimeWorker
    return { url: worker.url.as<string>() }
  }),
)

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
  stage: 'local-native',
  dev: true,
  sidecar: { omitEnv: ['CLOUDFLARE_'] },
})
const stack = beforeAll(deploy(Stack), { timeout: 120000 })
afterAll(destroy(Stack), { timeout: 60000 })

test(
  'formats Slovenian with the real Worker Intl implementation',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/intl`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({ en: '2 pieces', sl: '102 kosa', plural: 'two', date: '1970' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serializes competing reservations in native SQLite Durable Objects',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/wallet`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({
      successful: 1,
      reserved: { subscription: 2 },
      settled: { subscription: 10, purchased: 0, reservations: {} },
      other: { subscription: 0, purchased: 0, reservations: {} },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the isolated D1 schema and R2 binding',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/storage`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({
      database: {
        tables: [
          'accounts',
          'styld_auth_credentials',
          'styld_auth_identifiers',
          'styld_auth_passwords',
          'styld_auth_pending',
          'styld_auth_sessions',
        ],
      },
      media: { sentinel: false },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)
