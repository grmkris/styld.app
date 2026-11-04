import { landingRailPieces } from '@styld/protocol'
import { Duration, Effect, Schema, Stream } from 'effect'
import { Command, Mount, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { observed } from '../Observe.ts'

// The signed-out Home (owner, 4 November 2026): the wardrobe's film full screen behind its words, then one screen per
// feature (the wardrobe as a shop, one piece in many outfits, try-on, the turning rail, Ask Styld), then the way in,
// the price and four questions.
//
// The films always play; there is no control. Motion is still the browser's to allow. The server cannot know a
// visitor's motion preference, so a film's element starts without a source; once it is in the page the browser checks,
// and only then is a video asked for. With reduced motion or Save-Data none is, and a film the browser refuses to start
// (iOS Low Power) goes too: the poster stays. The rail tours by itself while it is on screen, and Styld's answer plays
// in each time its chat comes into view.

// MODEL

/** The hero's film: not yet started, playing, or still (reduced motion, Save-Data, or refused). */
export const Film = defineTaggedUnion({ Waiting: {}, Playing: {}, Still: {} })
export type Film = typeof Film.Type

/** The rail: whether it is near (its sprites load), on screen and allowed to move, which piece is in front, and how
 * many of the tour's ticks to sit out since the visitor last touched it. */
export const Rail = Schema.Struct({
  near: Schema.Boolean,
  shown: Schema.Boolean,
  moving: Schema.Boolean,
  front: Schema.Number,
  rest: Schema.Number,
})
export type Rail = typeof Rail.Type

export const Model = Schema.Struct({
  film: Film,
  rail: Rail,
  /** Styld's answer plays in while its chat is on screen. */
  chatShown: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  film: Film.Waiting(),
  rail: { near: false, shown: false, moving: false, front: 0, rest: 0 },
  chatShown: false,
})

/** The rail's scrolling row, for the tour's Command. */
export const railId = 'landing-rail'

/** The tour's beat: a turn takes 0.9 s, so each piece stays in front a little over a second once it has turned. */
const tourBeat = Duration.millis(2200)
/** A touch holds the tour for this many beats. */
const restAfterTouch = 2

// MESSAGE

export const Message = defineMessageUnion({
  /** Whether the film plays: false under reduced motion or Save-Data, or when the browser refused to start it. */
  CheckedMotion: { moving: Schema.Boolean },
  SawClip: {},
  NearedRail: {},
  ShowedRail: { shown: Schema.Boolean, moving: Schema.Boolean },
  SettledRail: { index: Schema.Number },
  TouchedRail: {},
  TickedRailTour: {},
  CompletedScrollRail: {},
  ShowedChat: { shown: Schema.Boolean },
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

/** Listeners on an element as an observer for `observed`. */
const listening = (events: ReadonlyArray<string>, listener: () => void) => ({
  observe: (element: Element) => {
    for (const event of events) element.addEventListener(event, listener, { passive: true })
  },
  disconnect: () => undefined,
})

/** The piece nearest the middle of the rail's row once it stops scrolling. */
const centredPiece = (row: Element) => {
  const middle = row.getBoundingClientRect().left + row.clientWidth / 2
  const pieces = Array.from(row.children)
  const distances = pieces.map((piece) => {
    const box = piece.getBoundingClientRect()
    return Math.abs(box.left + box.width / 2 - middle)
  })
  return distances.indexOf(Math.min(...distances))
}

/** The rail tells the page when it nears the screen (its sprites load), when it shows or goes, which piece the row
 * settles on after a swipe, and when the visitor touches it. */
export const WatchRail = Mount.defineStream('WatchRail', {
  messages: [Message.NearedRail, Message.ShowedRail, Message.SettledRail, Message.TouchedRail],
  execute: ({ element }) => {
    type Out =
      | typeof Message.NearedRail.Type
      | typeof Message.ShowedRail.Type
      | typeof Message.SettledRail.Type
      | typeof Message.TouchedRail.Type
    const near = observed<Out>(
      element,
      (offer) =>
        new IntersectionObserver(([entry]) => entry?.isIntersecting === true && offer(Message.NearedRail()), {
          rootMargin: '150% 0px',
        }),
    )
    const shown = observed<Out>(
      element,
      (offer) =>
        new IntersectionObserver(
          ([entry]) => entry && offer(Message.ShowedRail({ shown: entry.isIntersecting, moving: takesMotion() })),
          { threshold: 0.25 },
        ),
    )
    const touched = observed<Out>(element, (offer) =>
      listening(['pointerdown', 'wheel'], () => offer(Message.TouchedRail())),
    )
    // Safari has no `scrollend`: the row has settled once it has not scrolled for a moment.
    const settled = observed<Out>(element, (offer) => {
      let quiet: ReturnType<typeof setTimeout> | undefined
      return listening(['scroll'], () => {
        clearTimeout(quiet)
        quiet = setTimeout(() => offer(Message.SettledRail({ index: centredPiece(element) })), 140)
      })
    })
    return Stream.mergeAll([near, shown, touched, settled], { concurrency: 'unbounded' })
  },
})

/** Styld's answer plays in once a third of its chat shows, and again each time it comes back. */
export const WatchChat = Mount.defineStream('WatchChat', {
  messages: [Message.ShowedChat],
  execute: ({ element }) =>
    observed<typeof Message.ShowedChat.Type>(
      element,
      (offer) =>
        new IntersectionObserver(([entry]) => entry && offer(Message.ShowedChat({ shown: entry.isIntersecting })), {
          threshold: 0.3,
        }),
    ),
})

// COMMAND

/** Glide the rail's row so `index` is in the middle. */
export const ScrollRail = Command.define('ScrollRail', {
  args: { index: Schema.Number },
  messages: [Message.CompletedScrollRail],
  execute: ({ index }) =>
    Effect.sync(() => {
      const row = document.getElementById(railId)
      const piece = row?.children.item(index)
      if (row && piece instanceof HTMLElement)
        row.scrollTo({ left: piece.offsetLeft - (row.clientWidth - piece.offsetWidth) / 2, behavior: 'smooth' })
      return Message.CompletedScrollRail()
    }),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CheckedMotion: ({ moving }) => ({
      model: modifyFields(model, { film: () => (moving ? Film.Playing() : Film.Still()) }),
    }),
    SawClip: () => ({ model }),
    NearedRail: () => ({ model: modifyFields(model, { rail: () => modifyFields(model.rail, { near: () => true }) }) }),
    ShowedRail: ({ shown, moving }) => ({
      model: modifyFields(model, {
        rail: () => modifyFields(model.rail, { shown: () => shown, moving: () => moving, near: () => true }),
      }),
    }),
    SettledRail: ({ index }) => ({
      model: modifyFields(model, { rail: () => modifyFields(model.rail, { front: () => index }) }),
    }),
    TouchedRail: () => ({
      model: modifyFields(model, { rail: () => modifyFields(model.rail, { rest: () => restAfterTouch }) }),
    }),
    TickedRailTour: () => {
      if (model.rail.rest > 0)
        return { model: modifyFields(model, { rail: () => modifyFields(model.rail, { rest: (rest) => rest - 1 }) }) }
      const front = (model.rail.front + 1) % landingRailPieces.length
      return {
        model: modifyFields(model, { rail: () => modifyFields(model.rail, { front: () => front }) }),
        commands: [ScrollRail({ index: front })],
      }
    },
    CompletedScrollRail: () => ({ model }),
    ShowedChat: ({ shown }) => ({ model: modifyFields(model, { chatShown: () => shown }) }),
  })

// SUBSCRIPTION

/** The rail tours by itself while it is on screen and motion is allowed: the next piece comes to the front each beat. */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  railTour: entry(
    { touring: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ touring: model.rail.shown && model.rail.moving }),
      dependenciesToStream: ({ touring }) =>
        touring
          ? Stream.tick(tourBeat).pipe(
              Stream.drop(1),
              Stream.map(() => Message.TickedRailTour()),
            )
          : Stream.empty,
    },
  ),
}))

/** Whether a rail piece shows its front: the one in front while the rail is on screen; every other piece, and every
 * piece off screen, shows its side, so the front one turns again when the rail comes back. */
export const showsFront = (rail: Rail, index: number) => rail.shown && rail.front === index
