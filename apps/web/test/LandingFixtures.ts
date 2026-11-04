import { Mount } from 'foldkit/scene'
import { Message as LandingMessage, PlayRail, PlayWhileSeen, WatchChat } from '../src/page/Landing.ts'

// Everything on the signed-out Home below the hero waits for the screen, which a scene has none of: the three films,
// the rail's player and the two chats.

export const landingWaits = Mount.resolveAll(
  [PlayWhileSeen, LandingMessage.SawClip()],
  [PlayWhileSeen, LandingMessage.SawClip()],
  [PlayWhileSeen, LandingMessage.SawClip()],
  [PlayRail, LandingMessage.LoadedRail()],
  [WatchChat({ chat: 'ask' }), LandingMessage.ShowedChat({ chat: 'ask', shown: false })],
  [WatchChat({ chat: 'assistants' }), LandingMessage.ShowedChat({ chat: 'assistants', shown: false })],
)
