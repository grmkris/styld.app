import { type ProviderError } from '../providers/Errors.ts'
import { Context, type Effect } from 'effect'
import { type Picture } from '../capture/Providers.ts'
import type { TryOnSize } from './TryOnPrompt.ts'

/** What a try-on is drawn from: the person's own photo, each piece's picture with its words, in the order chosen, and
 * the canvas that keeps the photo's shape. */
export interface TryOnRequest {
  readonly photo: Picture
  readonly pieces: ReadonlyArray<{ readonly picture: Picture; readonly words: string }>
  readonly size: TryOnSize
}

/** The image model that redraws a person's photo wearing their pieces (Meta Muse Image). A refusal it did not bill
 * fails with `ProviderError`; an answer lost after it took the work is unknown, so it is never drawn twice. */
export class TryOnPainter extends Context.Service<
  TryOnPainter,
  { readonly tryOn: (request: TryOnRequest) => Effect.Effect<Picture, ProviderError> }
>()('@styld/server/generation/TryOnPainter') {}
