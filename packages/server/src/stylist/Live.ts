import { CurrentAccount } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import type { AssistantTools } from '../mcp/StyldTools.ts'
import { StylistTools } from './Service.ts'

/** Styld's tools for the Worker: the assistants' own (`StyldTools.ts`, built once), each run for the account as an
 * assistant would. */
export const stylistTools = (tools: AssistantTools) =>
  Layer.succeed(
    StylistTools,
    StylistTools.of({
      forAccount: (accountId) =>
        tools.map((tool) => ({
          ...tool,
          run: (args: unknown) =>
            tool.run(args).pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' })),
        })),
    }),
  )
