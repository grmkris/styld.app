import { Effect, Layer } from 'effect'
import { account } from '../Account.ts'
import { AccountLifecycle } from '../AccountLifecycle.ts'
import { capture } from '../capture/Module.ts'
import { Deployment } from '../Config.ts'
import { generation } from '../generation/Module.ts'
import { Database } from '../kernel/Db.ts'
import { module } from '../kernel/Module.ts'
import { links } from '../links/Module.ts'
import { mcpOAuthRoutes, mcpOAuthServer } from '../OAuth.ts'
import { forgetExpiredAssertions } from '../OAuthAssertions.ts'
import { outfits } from '../outfits/Module.ts'
import { photos } from '../photos/Module.ts'
import { Curation } from '../social/Curation.ts'
import { social } from '../social/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { mcpRoutes } from './Route.ts'
import { AssistantToolset } from './StyldTools.ts'
import { feedback } from '../feedback/Module.ts'
import { Feedback } from '../feedback/Feedback.ts'
import type { Sweep } from '../jobs/Sweeps.ts'

/** Assertions go a larger batch at a time: deleting them is one statement. */
const forgetBatch = 500

/** The assistants' tools over the modules they project; Styld's chat answers with the same ones. */
export const toolset = AssistantToolset.layer.pipe(
  Layer.provide([
    wardrobe.layer,
    links.layer,
    social.layer,
    capture.layer,
    generation.layer,
    photos.layer,
    outfits.layer,
    account.layer,
    feedback.layer,
  ]),
)

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
