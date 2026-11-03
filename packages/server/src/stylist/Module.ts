import { Effect, Layer } from 'effect'
import { consumer } from '../jobs/Jobs.ts'
import { moving } from '../jobs/Sweeps.ts'
import { module } from '../kernel/Module.ts'
import { toolset } from '../mcp/Module.ts'
import { AssistantToolset } from '../mcp/StyldTools.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { Worn } from '../worn/Worn.ts'
import { stylistHandlers } from './Http.ts'
import { stylistTools } from './Live.ts'
import { stylistJobQueue, stylistJobs } from './Queue.ts'
import { StylistChats } from './Service.ts'

/** Styld, the stylist in the app: chats in each account's Durable Object, replies written on their own queue with the
 * assistants' tools. */
export const stylist = module({
  layer: StylistChats.layer.pipe(
    Layer.provide([Layer.unwrap(Effect.map(AssistantToolset, stylistTools)), wardrobe.layer, Worn.layer]),
    Layer.provide(toolset),
  ),
  api: stylistHandlers,
  consumers: [consumer(stylistJobQueue, Effect.map(StylistChats, stylistJobs))],
  sweeps: [
    moving(
      'stylist',
      (stuck, until) => stuck.stylistTurns(until),
      (turnId) => Effect.flatMap(StylistChats, (owner) => owner.sweepTurn(turnId)),
    ),
  ],
})
