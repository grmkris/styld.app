import { GenerateSlowDown, StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { CurrentAccount } from '../CurrentAccount.ts'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Generations } from './Service.ts'

/** Ask only at the account's pace. */
const pacedBy =
  (allowGenerate: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const { accountId } = yield* CurrentAccount
      if (!(yield* allowGenerate(accountId))) return yield* GenerateSlowDown.make({})
      return yield* effect
    })

/** The website's generation endpoints: asking for stickers and mood boards at the account's pace, and reading how
 * they go. */
export const generationHandlers = (
  admit: Admit,
  allowGenerate: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>,
) =>
  HttpApiBuilder.group(StyldApi, 'generation', (handlers) =>
    Effect.gen(function* () {
      const generations = yield* Generations
      const paced = pacedBy(allowGenerate)
      return handlers
        .handle('makeSticker', ({ params, payload }) =>
          admit(asSessionAccount(paced(generations.admit('sticker', params.boardId, payload)))),
        )
        .handle('makeMoodBoard', ({ params, payload }) =>
          admit(asSessionAccount(paced(generations.admit('moodBoard', params.boardId, payload)))),
        )
        .handle('generation', ({ params }) => asSessionAccount(generations.get(params.generationId)))
        .handle('runningGeneration', ({ params }) => asSessionAccount(generations.running(params.boardId)))
    }),
  )
