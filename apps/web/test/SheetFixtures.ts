import { Animation } from '@foldkit/ui'
import { Command as SceneCommand } from 'foldkit/scene'
import { Command as StoryCommand } from 'foldkit/story'

// Sheets are animated Dialogs: each opening and closing paints, then waits for its animation to settle. A sheet's
// first opening is generation 1, its closing 2, and so on.

/** An animated sheet's paint and settled animation, as a story's steps. */
export const storySheetMoved = (generation: number) => [
  StoryCommand.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation })),
  StoryCommand.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation })),
]

/** An animated sheet's paint and settled animation, as a scene's steps. */
export const sceneSheetMoved = (generation: number) => [
  SceneCommand.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation })),
  SceneCommand.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation })),
]

/** A sheet a click opens inside a scene: its opening paints once for the click and again once its Mount has what it
 * needs, then its animation settles. */
export const sceneSheetOpened = [
  SceneCommand.resolveAll(
    [Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })],
    [Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })],
  ),
  SceneCommand.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
]
