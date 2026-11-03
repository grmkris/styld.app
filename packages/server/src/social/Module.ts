import { Effect, Layer } from 'effect'
import { withAuth } from '../AuthHttp.ts'
import { Boards } from '../boards/Boards.ts'
import { BoardStore } from '../boards/Store.ts'
import { boardHandlers } from '../boards/Http.ts'
import { consumer } from '../jobs/Jobs.ts'
import { module } from '../kernel/Module.ts'
import { lookHandlers } from '../looks/Http.ts'
import { Looks } from '../looks/Looks.ts'
import { Checks } from '../safety/Checks.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { checkJobQueue, checkJobs } from '../safety/Queue.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { wornHandlers } from '../worn/Http.ts'
import { Worn } from '../worn/Worn.ts'
import { Curation } from './Curation.ts'
import { Discovery } from './Discovery.ts'
import { profileHandlers } from './Http.ts'
import { Profiles } from './Profiles.ts'
import { PublicPages } from './Public.ts'
import { publicHandlers, publicImageRoutes } from './PublicHttp.ts'
import { Social } from './Social.ts'
import { socialHandlers } from './SocialHttp.ts'

/** What people make and show each other: checks, looks, worn days, profiles, public pages, follows and blocks,
 * discovery, curation and boards, each a service from its own layer. */
export const social = module({
  layer: Layer.mergeAll(Boards.layer, Social.layer, Discovery.layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(Looks.layer, PublicPages.layer, Profiles.layer, Curation.layer, Worn.layer, PieceChanged.layer),
    ),
    Layer.provideMerge(Checks.layer),
    Layer.provide([WardrobeStore.layer, BoardStore.layer]),
  ),
  api: Layer.mergeAll(
    lookHandlers,
    boardHandlers,
    wornHandlers,
    profileHandlers,
    socialHandlers,
    withAuth(publicHandlers),
  ),
  routes: publicImageRoutes,
  consumers: [consumer(checkJobQueue, Effect.map(Checks, checkJobs))],
  sweeps: [{ name: 'checks', run: Effect.flatMap(Checks, (checks) => checks.sweep()) }],
})
