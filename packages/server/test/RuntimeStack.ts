import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Effect, Redacted } from 'effect'
import { stylistThreadObjects, stylistThreadsOf, stylistThreadWorker } from '../src/Resources.ts'
import RuntimeWorker from './RuntimeWorker.ts'
import NativeWorkerLive, { NativeWorker } from './NativeWorker.ts'

export const makeStack = (generation: string) =>
  Alchemy.Stack(
    'StyldLocalAcceptance',
    {
      providers: Cloudflare.providers(),
      state: Alchemy.localState(),
    },
    Effect.gen(function* () {
      const worker = yield* RuntimeWorker
      yield* worker.bind('AcceptanceGeneration', { env: { TEST_GENERATION: generation } })
      const styld = yield* NativeWorker
      // The chats' Threads over the streaming fake model (`StylistThreadWorker.ts`).
      const threads = yield* Cloudflare.Worker('NativeStylistThreads', {
        ...stylistThreadWorker,
        main: 'packages/server/test/StylistThreadWorker.ts',
        env: { STYLD_API: styld, STYLIST_THREADS: stylistThreadObjects },
      })
      yield* styld.bind('StylistThreads', stylistThreadsOf(threads))
      // Execute the production SSR artifact in workerd. Website.Foldkit's dev
      // mode runs Vite in Node, which cannot prove the deployed Worker behavior.
      const website = yield* Cloudflare.Worker('NativeWebsite', {
        main: 'apps/web/dist/server/fetch.js',
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      const edge = yield* Cloudflare.Worker('NativeEdge', {
        main: 'packages/server/src/EdgeWorker.ts',
        env: { API: styld, WEBSITE: website, ROBOTS: 'noindex' },
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      // Native acceptance binds the same secret-text contract used by Alchemy's
      // preview stack. Values are test-only and never leave this process.
      yield* styld.bind('RuntimeConfiguration', {
        env: {
          AUTH_ORIGIN: edge.url,
          STYLD_ENV: 'local',
          STYLD_RELEASE: `native-${generation}`,
          // The import journey's admin (`ImportAcceptance.ts`).
          STYLD_ADMIN_EMAILS: 'native-import-admin@example.invalid',
          // The fakes' providers ask the fixture Worker in Meta's, Veo's and Clef's place (`test/fakes/`).
          TEST_FIXTURES: worker.url,
          META_API_KEY: Redacted.make('native-test-meta-key'),
          VIDEO_GATEWAY_API_KEY: Redacted.make('native-test-gateway-key'),
          STYLD_LITELLM_URL: 'https://native-text.invalid/v1',
          STYLD_LITELLM_KEY: Redacted.make('native-test-text-key'),
          AUTH_SECRET: Redacted.make('native-test-auth-secret-012345678901234567890123'),
          AUTH_SESSION_KEYS: Redacted.make(
            JSON.stringify({
              activeKeyId: 'native-test',
              keys: [{ id: 'native-test', material: 'a'.repeat(43) }],
            }),
          ),
          AUTH_PROOF_KEYS: Redacted.make(
            JSON.stringify({ activeKeyId: 'native-test', keys: [{ id: 'native-test', material: 'd'.repeat(43) }] }),
          ),
          AUTH_REQUEST_BINDING_KEYS: Redacted.make(
            JSON.stringify({ activeKeyId: 'native-test', keys: [{ id: 'native-test', material: 'e'.repeat(43) }] }),
          ),
        },
      })
      return {
        url: worker.url.as<string>(),
        styldUrl: edge.url.as<string>(),
        apiUrl: styld.url.as<string>(),
        websiteUrl: website.url.as<string>(),
      }
    }).pipe(Effect.provide(NativeWorkerLive)),
  )
