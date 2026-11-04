import { Effect, Schema } from 'effect'
import { Command, Mount, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { observed } from '../Observe.ts'

// The signed-out Home (owner, 4 November 2026): a full-screen film, one of three heroes the server chose
// (`server/LandingHero.ts`), and one short page below it: three feature screens, the price and four questions.
//
// Motion is the browser's to allow. The server cannot know a visitor's motion preference, so the film's element starts
// without a source; once it is in the page the browser checks, and only then is a video asked for. With reduced motion or
// Save-Data none is: the poster stays and the film's element goes. The control follows the element's own play and pause
// events, so a film the browser refused to start (iOS Low Power) offers Play.

// MODEL

/** The film: not yet checked, still (reduced motion), or playing or paused as the element last said. */
export const Film = defineTaggedUnion({ Waiting: {}, Still: {}, Playing: {}, Paused: {} })
export type Film = typeof Film.Type

/** A shop category the chips filter by; `all` shows every piece. */
export const ShopFilter = Schema.Literals(['all', 'top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'])
export type ShopFilter = typeof ShopFilter.Type

/** The chips in the order they read: All, then each category the grid has. */
export const shopFilters: ReadonlyArray<ShopFilter> = ShopFilter.literals

export const Model = Schema.Struct({
  film: Film,
  /** The person paused the motion: the film and the clips below stay still until they press Play. */
  held: Schema.Boolean,
  shop: ShopFilter,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ film: Film.Waiting(), held: false, shop: 'all' })

/** The element the film plays in, for the control's Command. */
export const filmId = 'landing-film'

// MESSAGE

export const Message = defineMessageUnion({
  CheckedMotion: { moving: Schema.Boolean },
  PlayedFilm: {},
  PausedFilm: {},
  ClickedFilmControl: {},
  CompletedSetFilm: {},
  ClickedShopFilter: { filter: ShopFilter },
  SawClip: {},
})
export type Message = typeof Message.Type

// MOUNT

/** Whether this browser takes motion: no reduced motion asked for, no Save-Data. */
/** A browser saving data (the Network Information API, which not every browser has and the DOM types omit). */
const isSavingData = Schema.is(Schema.Struct({ connection: Schema.Struct({ saveData: Schema.Literal(true) }) }))

const takesMotion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !isSavingData(navigator)

/** The tall film on a phone held upright, the wide one elsewhere (the poster's `<picture>` asks the same). */
export const tallQuery = '(max-aspect-ratio: 4/5)'

/** Start the film the element is for, once the browser allows motion: muted, inline, the shape the screen has. It says
 * whether motion is allowed; play and pause then come from the element's events. */
export const StartFilm = Mount.define('StartFilm', {
  args: { tall: Schema.String, wide: Schema.String },
  messages: [Message.CheckedMotion],
  execute: ({ element, tall, wide }) =>
    Effect.sync(() => {
      if (!(element instanceof HTMLVideoElement) || !takesMotion()) return Message.CheckedMotion({ moving: false })
      element.muted = true
      element.src = window.matchMedia(tallQuery).matches ? tall : wide
      element.play().catch(() => undefined)
      return Message.CheckedMotion({ moving: true })
    }),
})

/** A feature clip plays only while most of it is on screen, never with reduced motion or while the person holds the
 * motion; it asks for its video the first time it nears the screen. */
export const PlayWhileSeen = Mount.defineStream('PlayWhileSeen', {
  args: { src: Schema.String },
  messages: [Message.SawClip],
  execute: ({ element, src }) =>
    observed<typeof Message.SawClip.Type>(
      element,
      (offer) =>
        new IntersectionObserver(
          ([entry]) => {
            if (!(element instanceof HTMLVideoElement) || entry === undefined || !takesMotion()) return
            if (!entry.isIntersecting || element.closest('[data-held]') !== null) {
              element.pause()
              return
            }
            if (element.getAttribute('src') === null) {
              element.muted = true
              element.src = src
              offer(Message.SawClip())
            }
            element.play().catch(() => undefined)
          },
          { threshold: 0.5 },
        ),
    ),
})

// COMMAND

/** Play or pause the film, and with a pause every clip below it. */
export const SetFilm = Command.define('SetFilm', {
  args: { play: Schema.Boolean },
  messages: [Message.CompletedSetFilm],
  execute: ({ play }) =>
    Effect.sync(() => {
      const film = document.getElementById(filmId)
      if (film instanceof HTMLVideoElement) {
        if (play) film.play().catch(() => undefined)
        else film.pause()
      }
      if (!play)
        for (const clip of document.querySelectorAll('[data-clip]')) if (clip instanceof HTMLVideoElement) clip.pause()
      return Message.CompletedSetFilm()
    }),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CheckedMotion: ({ moving }) => ({
      model: modifyFields(model, { film: () => (moving ? Film.Paused() : Film.Still()) }),
    }),
    // The element says what it does; a still page has no element to say it.
    PlayedFilm: () => ({
      model: Film.guards.Still(model.film) ? model : modifyFields(model, { film: () => Film.Playing() }),
    }),
    PausedFilm: () => ({
      model: Film.guards.Still(model.film) ? model : modifyFields(model, { film: () => Film.Paused() }),
    }),
    ClickedFilmControl: () => {
      const play = !Film.guards.Playing(model.film)
      return { model: modifyFields(model, { held: () => !play }), commands: [SetFilm({ play })] }
    },
    CompletedSetFilm: () => ({ model }),
    ClickedShopFilter: ({ filter }) => ({ model: modifyFields(model, { shop: () => filter }) }),
    SawClip: () => ({ model }),
  })
