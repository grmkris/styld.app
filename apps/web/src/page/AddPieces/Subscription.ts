import { Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { holdScreenAwake } from '../../capture/ScreenAwake.ts'
import * as HeldCamera from '../HeldCamera.ts'
import type { Message } from './Message.ts'
import { isReadingVideo, type Model } from './Model.ts'

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  /** The screen stays on while a video is read, from its first part to its last, and while the camera is
   * open; the lock goes once neither is. */
  screenAwake: entry(
    { awake: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        awake: model.items.some(isReadingVideo) || HeldCamera.isLive(model.held),
      }),
      dependenciesToStream: ({ awake }) => (awake ? Stream.fromEffectDrain(holdScreenAwake) : Stream.empty),
    },
  ),
}))
