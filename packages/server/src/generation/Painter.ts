import { Context, Effect } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { type Picture, ProviderFailed, ProviderOutcomeUnknown } from '../capture/Providers.ts'

/** What a generated picture is drawn from: the person's words, framed for a board, and the pictures of the pieces it
 * shows. Cut-outs and clean pictures only: never a photo, and never a face. */
export interface PaintRequest {
  readonly prompt: string
  readonly references: ReadonlyArray<Picture>
}

/** The image model that makes pictures for boards (Meta Muse Image), named as each picture records it. A refusal it did
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

/** A 1×1 PNG: what the stand-in paints. */
const standInPicture = Base64.decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
)

/** Native acceptance's painter: a small picture for any words, refused for `[[refuse]]`, lost on the way for
 * `[[lost]]`. */
export const standInPainter = {
  model: 'stand-in',
  paint: (request: PaintRequest) => {
    if (request.prompt.includes('[[refuse]]'))
      return Effect.fail(new ProviderFailed({ provider: 'stand-in', retryable: false }))
    if (request.prompt.includes('[[lost]]')) return Effect.fail(new ProviderOutcomeUnknown({ provider: 'stand-in' }))
    return Effect.fromResult(standInPicture).pipe(
      Effect.map((bytes): Picture => ({ bytes, contentType: 'image/png' })),
      Effect.mapError(() => new ProviderFailed({ provider: 'stand-in', retryable: false })),
    )
  },
}
