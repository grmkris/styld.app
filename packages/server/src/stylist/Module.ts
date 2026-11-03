import { Effect, Layer } from 'effect'
import { module } from '../kernel/Module.ts'
import { toolset } from '../mcp/Module.ts'
import { AssistantToolset } from '../mcp/StyldTools.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { Worn } from '../worn/Worn.ts'
import { stylistHandlers } from './Http.ts'
import { stylistTools } from './Live.ts'
import { StylistChats } from './Service.ts'

/** Styld, the stylist in the app: each chat a Thread in the Thread Worker, listed per account in D1, its tools the
 * assistants' own. */
export const stylist = module({
  layer: StylistChats.layer.pipe(
    Layer.provide([Layer.unwrap(Effect.map(AssistantToolset, stylistTools)), wardrobe.layer, Worn.layer]),
    Layer.provide(toolset),
  ),
  api: stylistHandlers,
})
