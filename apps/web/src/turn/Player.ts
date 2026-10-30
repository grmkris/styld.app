import type { TurnLayout } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { TurnPlayhead } from './Controller.ts'

/** The turn's sheet could not be shown: not loaded, or no canvas to draw on. */
class TurnNotShown extends Schema.TaggedError<TurnNotShown>()('TurnNotShown', {}) {}

// A full turn, side to front, takes a little under a second, as in the starter (950 ms).
const turnMs = 950

const loaded = (url: string) =>
  Effect.tryPromise(
    () =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.decoding = 'async'
        image.addEventListener('load', () => resolve(image), { once: true })
        image.addEventListener('error', () => reject(TurnNotShown.make({})), { once: true })
        image.src = url
      }),
  )

/** Play a turn's frame sheet on `canvas`: it rests on the front, and each press of the button around it turns the
 * garment to its side and back, retargeting smoothly mid-turn. Reduced motion jumps between the two. The sheet's
 * listeners and frames go when the canvas leaves the page. */
export const playTurn = (canvas: HTMLCanvasElement, url: string, layout: TurnLayout) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const sheet = yield* loaded(url)
      const context = canvas.getContext('2d')
      if (context === null) return yield* TurnNotShown.make({})
      canvas.width = layout.width
      canvas.height = layout.height
      const playhead = new TurnPlayhead(turnMs, 1)
      const reduced = matchMedia('(prefers-reduced-motion: reduce)')
      const paint = () => {
        const frame = playhead.frame(layout.frames)
        const column = frame % layout.columns
        const row = Math.floor(frame / layout.columns)
        context.clearRect(0, 0, layout.width, layout.height)
        context.drawImage(
          sheet,
          column * layout.width,
          row * layout.height,
          layout.width,
          layout.height,
          0,
          0,
          layout.width,
          layout.height,
        )
      }
      let request = 0
      let last = 0
      const tick = (time: number) => {
        const moving = playhead.step(last === 0 ? 0 : time - last)
        last = time
        paint()
        request = moving ? requestAnimationFrame(tick) : 0
        if (!moving) last = 0
      }
      const press = () => {
        playhead.turnTo(playhead.target === 1 ? 0 : 1, reduced.matches)
        button?.setAttribute('aria-pressed', String(playhead.target === 0))
        if (request === 0) request = requestAnimationFrame(tick)
      }
      const button = canvas.closest('button')
      button?.addEventListener('click', press)
      paint()
      return () => {
        button?.removeEventListener('click', press)
        cancelAnimationFrame(request)
      }
    }),
    (stop) => Effect.sync(stop),
  )
