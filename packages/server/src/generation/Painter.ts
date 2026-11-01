import { type ProviderError } from '../providers/Errors.ts'
import { type KeyColour } from '@styld/imaging'
import { Context, Effect } from 'effect'
import { type Picture } from '../capture/Providers.ts'

/** What a sticker is drawn from: the person's words, framed as a sticker, on a flat key colour to cut it out by. */
export interface PaintRequest {
  readonly prompt: string
  readonly key: KeyColour
}

/** The image model that draws stickers for boards (Meta Muse Image), named as each picture records it. A refusal it did
 * not bill fails with `ProviderError`; an answer lost after it took the work is unknown, so it is never drawn twice. */
export class PicturePainter extends Context.Service<
  PicturePainter,
  {
    readonly model: string
    readonly paint: (request: PaintRequest) => Effect.Effect<Picture, ProviderError>
  }
>()('@styld/server/PicturePainter') {}
