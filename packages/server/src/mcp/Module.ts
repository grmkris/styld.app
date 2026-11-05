import { Effect, Layer } from 'effect'
import { AccountLifecycle } from '../AccountLifecycle.ts'
import { Deployment } from '../Config.ts'
import { Database } from '../kernel/Db.ts'
import { module } from '../kernel/Module.ts'
import { mcpOAuthRoutes, mcpOAuthServer } from './OAuth.ts'
import { forgetExpiredAssertions } from './OAuthAssertions.ts'
import { Curation } from '../social/Curation.ts'
import { mcpRoutes } from './Route.ts'
import { AssistantToolset } from '../tools/StyldTools.ts'
import { toolset } from '../tools/Toolset.ts'
import { feedback } from '../feedback/Module.ts'
import { Feedback } from '../feedback/Feedback.ts'
import type { Sweep } from '../jobs/Sweeps.ts'

/** Assertions go a larger batch at a time: deleting them is one statement. */
const forgetBatch = 500

/** Expired OAuth assertions go, a batch at a time. */
const sweeps: ReadonlyArray<Sweep<Database>> = [
  { name: 'assertions', run: Effect.flatMap(Database, (db) => forgetExpiredAssertions(db.$client, forgetBatch)) },
]

/** Assistants over MCP: the OAuth server that authorizes them, `/mcp` and its tools. */
export const mcp = module({
  layer: Layer.mergeAll(toolset, feedback.layer, mcpOAuthServer),
  routes: Layer.mergeAll(
    mcpOAuthRoutes,
    Layer.unwrap(
      Effect.gen(function* () {
        const { release, admins } = yield* Deployment
        const served = {
          tools: yield* AssistantToolset,
          curation: yield* Curation,
          feedback: yield* Feedback,
          accounts: yield* AccountLifecycle,
        }
        return mcpRoutes(release, served, admins)
      }),
    ),
  ),
  sweeps,
})
