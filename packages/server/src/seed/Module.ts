import { Layer } from 'effect'
import { imports } from '../imports/Module.ts'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { ImportStore } from '../imports/Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { seedHandlers } from './Http.ts'
import { Seeding } from './Seeding.ts'
import { SeedStore } from './Store.ts'

/** The house inspiration boards, seeded by the operator (owner, 4 November 2026): built as the house accounts through
 * the boards' and profiles' own services, over the garments the import made. */
export const seed = module({
  layer: Seeding.layer.pipe(
    Layer.provide([SeedStore.layer, ImportStore.layer, WardrobeStore.layer, social.layer, imports.layer]),
  ),
  api: seedHandlers,
})
