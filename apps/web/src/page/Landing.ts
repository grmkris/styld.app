import { landingTurnFrames } from '@styld/protocol'
import { Effect, Queue, Schema, Stream } from 'effect'
import { Mount, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { observed } from '../Observe.ts'

// The signed-out Home (owner, 4 November 2026): the wardrobe's film full screen behind its words, then one screen per
// feature (the wardrobe as a shop, one piece in many outfits, try-on, the turning rail, Ask Styld, Styld in ChatGPT and
// Claude), then the plans and four questions.
//
// The films always play; there is no control. Motion is still the browser's to allow. The server cannot know a
// visitor's motion preference, so a film's element starts without a source; once it is in the page the browser checks,
// and only then is a video asked for. With reduced motion or Save-Data none is, and a film the browser refuses to start
// (iOS Low Power) goes too: the poster stays. The rail is its own player (`RailPlayer.ts`), and each chat's answer
// plays in each time the chat comes into view.

// MODEL

/** The hero's film: not yet started, playing, or still (reduced motion, Save-Data, or refused). */
export const Film = defineTaggedUnion({ Waiting: {}, Playing: {}, Still: {} })
export type Film = typeof Film.Type

/** The two chats: Ask Styld, and Styld answering inside ChatGPT or Claude. */
export const Chat = Schema.Literals(['ask', 'assistants'])
export type Chat = typeof Chat.Type

export const Model = Schema.Struct({
  film: Film,
  /** A chat's answer plays in while the chat is on screen. */
  playing: Schema.Struct({ ask: Schema.Boolean, assistants: Schema.Boolean }),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ film: Film.Waiting(), playing: { ask: false, assistants: false } })

// MESSAGE

export const Message = defineMessageUnion({
  /** Whether the film plays: false under reduced motion or Save-Data, or when the browser refused to start it. */
  CheckedMotion: { moving: Schema.Boolean },
  SawClip: {},
  LoadedRail: {},
  ShowedChat: { chat: Chat, shown: Schema.Boolean },
})
export type Message = typeof Message.Type

// MOUNT

/** A browser saving data (the Network Information API, which not every browser has and the DOM types omit). */
const isSavingData = Schema.is(Schema.Struct({ connection: Schema.Struct({ saveData: Schema.Literal(true) }) }))

/** Whether this browser takes motion: no reduced motion asked for, no Save-Data. */
const takesMotion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !isSavingData(navigator)

/** The tall film on a phone held upright, the wide one elsewhere (the poster's `<picture>` asks the same). */
export const tallQuery = '(max-aspect-ratio: 4/5)'

/** Start the hero's film once the browser allows motion: muted, inline, the shape the screen has. It says whether the
 * film plays once the browser has started it or refused. */
export const StartFilm = Mount.define('StartFilm', {
  args: { tall: Schema.String, wide: Schema.String },
  messages: [Message.CheckedMotion],
  execute: ({ element, tall, wide }) => {
    if (!(element instanceof HTMLVideoElement) || !takesMotion())
      return Effect.succeed(Message.CheckedMotion({ moving: false }))
    element.muted = true
    element.src = window.matchMedia(tallQuery).matches ? tall : wide
    return Effect.tryPromise(() => element.play()).pipe(
      Effect.match({
        onFailure: () => Message.CheckedMotion({ moving: false }),
        onSuccess: () => Message.CheckedMotion({ moving: true }),
      }),
    )
  },
})

/** A screen's film: fetched a screen and a half ahead so it is ready, played from the moment an eighth of it shows,
 * paused once it has gone; never with reduced motion or Save-Data, and one the browser refuses to start goes. */
export const PlayWhileSeen = Mount.defineStream('PlayWhileSeen', {
  args: { tall: Schema.String, wide: Schema.String },
  messages: [Message.SawClip],
  execute: ({ element, tall, wide }) => {
    if (!(element instanceof HTMLVideoElement) || !takesMotion()) return Stream.empty
    const load = () => {
      if (element.getAttribute('src') !== null) return false
      element.muted = true
      element.preload = 'auto'
      element.src = window.matchMedia(tallQuery).matches ? tall : wide
      return true
    }
    const near = observed<typeof Message.SawClip.Type>(
      element,
      (offer) =>
        new IntersectionObserver(([entry]) => entry?.isIntersecting === true && load() && offer(Message.SawClip()), {
          rootMargin: '150% 0px',
        }),
    )
    const seen = observed<typeof Message.SawClip.Type>(
      element,
      () =>
        new IntersectionObserver(
          ([entry]) => {
            if (entry === undefined) return
            if (!entry.isIntersecting) return element.pause()
            if (entry.intersectionRatio < 0.05) return
            load()
            element.play().catch((error: unknown) => {
              if (error instanceof DOMException && error.name === 'NotAllowedError') element.remove()
            })
          },
          { threshold: [0, 0.12] },
        ),
    )
    return Stream.merge(near, seen)
  },
})

/** The rail's player on its rack, for as long as the rack is in the page: hover and swipe, the tour, the turns. It
 * says when its pieces are on the rail (`RailPlayer.ts`, loaded with the Mount). */
export const PlayRail = Mount.defineStream('PlayRail', {
  args: { sprites: Schema.Array(Schema.String) },
  messages: [Message.LoadedRail],
  execute: ({ element, sprites }) =>
    element instanceof HTMLElement
      ? Stream.callback<typeof Message.LoadedRail.Type>((queue) =>
          Effect.acquireRelease(
            // The player's code loads only now, as the rail comes into the page: it is not in the first bundle.
            Effect.promise(() => import('./RailPlayer.ts')).pipe(
              Effect.map(({ playRail }) =>
                playRail(element, { sprites, frames: landingTurnFrames, frameWidth: 384, frameHeight: 448 }, () => {
                  Queue.offerUnsafe(queue, Message.LoadedRail())
                }),
              ),
            ),
            (stop) => Effect.sync(stop),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
      : Stream.empty,
})

/** A chat's answer plays in once a third of the chat shows, and again each time it comes back. */
export const WatchChat = Mount.defineStream('WatchChat', {
  args: { chat: Chat },
  messages: [Message.ShowedChat],
  execute: ({ element, chat }) =>
    observed<typeof Message.ShowedChat.Type>(
      element,
      (offer) =>
        new IntersectionObserver(
          ([entry]) => entry && offer(Message.ShowedChat({ chat, shown: entry.isIntersecting })),
          { threshold: 0.3 },
        ),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CheckedMotion: ({ moving }) => ({
      model: modifyFields(model, { film: () => (moving ? Film.Playing() : Film.Still()) }),
    }),
    SawClip: () => ({ model }),
    LoadedRail: () => ({ model }),
    ShowedChat: ({ chat, shown }) => ({
      model: modifyFields(model, {
        playing: () => modifyFields(model.playing, chat === 'ask' ? { ask: () => shown } : { assistants: () => shown }),
      }),
    }),
  })
