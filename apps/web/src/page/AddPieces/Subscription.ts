import { Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { holdScreenAwake } from '../../capture/ScreenAwake.ts'
import type { Message } from './Message.ts'
import { isReadingVideo, type Model } from './Model.ts'

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  /** The screen stays on while a video is read, from its first part to its last; the lock goes once the
   * video is sent or stops. */
  screenAwake: entry(
    { readingVideo: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ readingVideo: model.items.some(isReadingVideo) }),
      dependenciesToStream: ({ readingVideo }) =>
        readingVideo ? Stream.fromEffectDrain(holdScreenAwake) : Stream.empty,
    },
  ),
}))
