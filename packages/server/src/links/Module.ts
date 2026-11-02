import { Layer } from 'effect'
import { module } from '../kernel/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { linkHandlers } from './Http.ts'
import { Links } from './Links.ts'

/** Reading a shop's product page, and a picture from the web, into an upload. */
export const links = module({
  layer: Links.layer.pipe(Layer.provide(wardrobe.layer)),
  api: linkHandlers,
})
