import { Option, Schema, Stream } from 'effect'
import { ManagedResource, Subscription } from 'foldkit'
import { holdScreenAwake } from '../../capture/ScreenAwake.ts'
import * as HeldCamera from '../HeldCamera.ts'
import { Message } from './Message.ts'
import { isReadingVideo, type Model } from './Model.ts'

const screenSubscriptions = Subscription.make<Model, Message>()((entry) => ({
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

/** The held-up camera's slot on this page, for its picture's watch and its live camera. */
const heldCamera = {
  read: (model: Model) => Option.some(model.held),
  toParentMessage: (message: HeldCamera.Message) => Message.GotHeldCameraMessage({ message }),
}

export const subscriptions = Subscription.aggregate(
  screenSubscriptions,
  Subscription.lift(HeldCamera.subscriptions)<Model, Message>(heldCamera),
)

/** The live camera, held while the camera screen is up. */
export const managedResources = ManagedResource.lift(HeldCamera.managedResources)<Model, Message>(heldCamera)
