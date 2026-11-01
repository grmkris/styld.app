import { Effect } from 'effect'
import type { Captures } from '../capture/Service.ts'
import type { Generations } from '../generation/Service.ts'
import type { D1 } from '../OAuth.ts'
import { forgetExpiredAssertions } from '../OAuthAssertions.ts'
import type { Outfits } from '../outfits/Outfits.ts'
import type { Photos } from '../photos/Photos.ts'
import { forgetOldReceipts } from '../kernel/Receipts.ts'
import type { Checks } from '../safety/Checks.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { drizzle } from 'drizzle-orm/d1'
import { before, type Sweep, stuckAfter, stuckRows, sweepEach, unbuiltAfter } from './Sweeps.ts'

/** Receipts and assertions go a larger batch at a time: deleting them is one statement. */
const forgetBatch = 500

/** A sweep of rows stuck since `stuckAfter`, each moved by its owner. */
const moving = <A>(
  name: string,
  rows: (until: Date) => Effect.Effect<ReadonlyArray<A>, unknown>,
  move: (row: A) => Effect.Effect<unknown, unknown>,
): Sweep => ({
  name,
  run: Effect.flatMap(before(stuckAfter), rows).pipe(Effect.flatMap((found) => sweepEach(found, move))),
})

/** Every sweep the cron runs, each moving its rows through the module that owns them. */
export const applicationSweeps = (
  database: D1 & Parameters<typeof drizzle>[0],
  services: {
    readonly wardrobeService: Pick<Wardrobe['Service'], 'failPiece' | 'sweepUploads'>
    readonly capturesService: Pick<Captures['Service'], 'failCapture' | 'failPicture' | 'failTurn'>
    readonly photosService: Pick<Photos['Service'], 'failFinding'>
    readonly generationsService: Pick<Generations['Service'], 'sweep'>
    readonly checksService: Pick<Checks['Service'], 'sweep'>
    readonly outfitsService: Pick<Outfits['Service'], 'sweep'>
  },
): ReadonlyArray<Sweep> => {
  const stuck = stuckRows(database)
  const { wardrobeService: wardrobe, capturesService: captures } = services
  return [
    moving('pieces', stuck.pieces, wardrobe.failPiece),
    moving('captures', stuck.captures, captures.failCapture),
    moving('pictures', stuck.pictures, captures.failPicture),
    moving(
      'turns',
      (until) => Effect.flatMap(before(unbuiltAfter), (unbuilt) => stuck.turns(until, unbuilt)),
      captures.failTurn,
    ),
    moving('photos', stuck.photos, services.photosService.failFinding),
    { name: 'generation', run: services.generationsService.sweep() },
    { name: 'checks', run: services.checksService.sweep() },
    { name: 'thinking', run: Effect.as(services.outfitsService.sweep(), 0) },
    { name: 'uploads', run: wardrobe.sweepUploads() },
    { name: 'receipts', run: forgetOldReceipts(drizzle(database), forgetBatch) },
    { name: 'assertions', run: forgetExpiredAssertions(database, forgetBatch) },
  ]
}
