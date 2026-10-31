import { encodePng, type KeyColour } from '@styld/imaging'
import { Context, Effect } from 'effect'
import { type Picture, ProviderFailed, ProviderOutcomeUnknown } from '../capture/Providers.ts'

/** What a sticker is drawn from: the person's words, framed as a sticker, on a flat key colour to cut it out by. */
export interface PaintRequest {
  readonly prompt: string
  readonly key: KeyColour
}

/** The image model that draws stickers for boards (Meta Muse Image), named as each picture records it. A refusal it did
 * not bill fails with `ProviderFailed`; an answer lost after it took the work is unknown, so it is never drawn twice. */
export class PicturePainter extends Context.Service<
  PicturePainter,
  {
    readonly model: string
    readonly paint: (request: PaintRequest) => Effect.Effect<Picture, ProviderFailed | ProviderOutcomeUnknown>
  }
>()('@styld/server/PicturePainter') {
  /** No image model: every picture is refused, and its credit given back. */
  static readonly off = {
    model: 'off',
    paint: () => Effect.fail(new ProviderFailed({ provider: 'off', retryable: false })),
  }
}

const side = 64
const keyRgb = { green: [0, 255, 0], magenta: [255, 0, 255] } as const

/** What the stand-in paints: a dark square in the middle of a flat key colour, which keys out as a real drawing does. */
const standInPicture = (key: KeyColour): Picture => {
  const data = new Uint8Array(side * side * 4)
  for (let at = 0; at < side * side; at++) {
    const row = Math.floor(at / side)
    const column = at % side
    const inside = row >= 16 && row < 48 && column >= 16 && column < 48
    const [red, green, blue] = inside ? [40, 30, 90] : keyRgb[key]
    data.set([red, green, blue, 255], at * 4)
  }
  return { bytes: encodePng({ width: side, height: side, data }), contentType: 'image/png' }
}

/** Native acceptance's painter: a keyable picture for any words, refused for `[[refuse]]`, lost on the way for
 * `[[lost]]`. */
export const standInPainter: PicturePainter['Service'] = {
  model: 'stand-in',
  paint: (request: PaintRequest) => {
    if (request.prompt.includes('[[refuse]]'))
      return Effect.fail(new ProviderFailed({ provider: 'stand-in', retryable: false }))
    if (request.prompt.includes('[[lost]]')) return Effect.fail(new ProviderOutcomeUnknown({ provider: 'stand-in' }))
    return Effect.succeed(standInPicture(request.key))
  },
}
