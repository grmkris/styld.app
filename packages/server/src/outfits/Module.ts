import { Effect, Layer } from 'effect'
import { module } from '../kernel/Module.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { outfitHandlers } from './Http.ts'
import { Outfits } from './Outfits.ts'

/** The outfit engine, Fast and Thinking, over the wardrobe's pieces. */
export const outfits = module({
  layer: Outfits.layer.pipe(Layer.provide(WardrobeStore.layer)),
  api: outfitHandlers,
  sweeps: [
    {
      name: 'thinking',
      run: Effect.as(
        Effect.flatMap(Outfits, (owner) => owner.sweep()),
        0,
      ),
    },
  ],
})
