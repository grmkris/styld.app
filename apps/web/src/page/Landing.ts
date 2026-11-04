import { Effect, Schema } from 'effect'
import { Mount, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { observed } from '../Observe.ts'

// The signed-out Home (owner, 4 November 2026): the wardrobe's film full screen behind the words, and one short page
// below it: three feature screens, the price and four questions.
//
// The films always play; there is no control (owner, 4 November 2026). Motion is still the browser's to allow. The
// server cannot know a visitor's motion preference, so the film's element starts without a source; once it is in the
// page the browser checks, and only then is a video asked for. With reduced motion or Save-Data none is, and a film the
// browser refuses to start (iOS Low Power) goes too: the poster stays.

// MODEL

/** The film: not yet started, playing, or still (reduced motion, Save-Data, or refused). */
export const Film = defineTaggedUnion({ Waiting: {}, Playing: {}, Still: {} })
export type Film = typeof Film.Type

/** A shop category the chips filter by; `all` shows every piece. */
export const ShopFilter = Schema.Literals(['all', 'top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'])
export type ShopFilter = typeof ShopFilter.Type

/** The chips in the order they read: All, then each category the grid has. */
export const shopFilters: ReadonlyArray<ShopFilter> = ShopFilter.literals

export const Model = Schema.Struct({ film: Film, shop: ShopFilter })
export type Model = typeof Model.Type

export const init = (): Model => ({ film: Film.Waiting(), shop: 'all' })

// MESSAGE

export const Message = defineMessageUnion({
  /** Whether the film plays: false under reduced motion or Save-Data, or when the browser refused to start it. */
  CheckedMotion: { moving: Schema.Boolean },
  ClickedShopFilter: { filter: ShopFilter },
  SawClip: {},
})
export type Message = typeof Message.Type

// MOUNT

/** A browser saving data (the Network Information API, which not every browser has and the DOM types omit). */
const isSavingData = Schema.is(Schema.Struct({ connection: Schema.Struct({ saveData: Schema.Literal(true) }) }))

/** Whether this browser takes motion: no reduced motion asked for, no Save-Data. */
const takesMotion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !isSavingData(navigator)

/** The tall film on a phone held upright, the wide one elsewhere (the poster's `<picture>` asks the same). */
export const tallQuery = '(max-aspect-ratio: 4/5)'

/** Start the film the element is for, once the browser allows motion: muted, inline, the shape the screen has. It says
 * whether the film plays once the browser has started it or refused. */
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

/** A feature clip plays only while most of it is on screen, never with reduced motion; it asks for its video the first
 * time it nears the screen. */
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
            if (!entry.isIntersecting) {
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

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    CheckedMotion: ({ moving }) => ({
      model: modifyFields(model, { film: () => (moving ? Film.Playing() : Film.Still()) }),
    }),
    ClickedShopFilter: ({ filter }) => ({ model: modifyFields(model, { shop: () => filter }) }),
    SawClip: () => ({ model }),
  })
