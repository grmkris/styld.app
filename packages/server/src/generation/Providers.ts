import { Layer } from 'effect'
import { makeMusePainter, type MuseSettings } from '../capture/Muse.ts'
import { livePlanner, MoodPlanner, type RunPlanner, standInPlanner } from './Planner.ts'
import { PicturePainter, standInPainter } from './Painter.ts'

/** The painter and planner the Worker's environment names: Meta Muse Image and a Workers AI planner where
 * `GENERATED_PICTURES=muse` (the preview), the stand-ins in native acceptance, and no painter otherwise. */
export const generationProviders = (choice: unknown, meta: MuseSettings, runPlanner: RunPlanner) =>
  Layer.mergeAll(
    Layer.succeed(
      PicturePainter,
      choice === 'muse' ? makeMusePainter(meta) : choice === 'stand-in' ? standInPainter : PicturePainter.off,
    ),
    Layer.succeed(MoodPlanner, choice === 'muse' ? livePlanner(runPlanner, meta.metrics) : standInPlanner),
  )
