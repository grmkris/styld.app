import { Layer } from 'effect'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { linkHandlers } from './Http.ts'
import { Links } from './Links.ts'

/** Reading a shop's product page, and a picture from the web, into an upload, and the pieces and boards' pictures
 * made from them. */
export const links = module({
  layer: Links.layer.pipe(Layer.provide([wardrobe.layer, social.layer])),
  api: linkHandlers,
})
