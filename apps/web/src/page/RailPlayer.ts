import {
  advance,
  aim,
  frameAt,
  mobileRailPositions,
  type Playhead,
  playhead,
  rackPositions,
  slideStep,
  swipeDestination,
  type TurnTiming,
} from './RailMotion.ts'

// A deliberate escape hatch from Foldkit's Model and view: the rail is an imperative player, run by the `PlayRail`
// Mount (Landing.ts) on the rack the view renders. It owns its pointer, momentum and animation-frame state and paints
// sprite frames on canvases, which a Model updated sixty times a second would only copy; it reports to the page through
// the Mount's Messages, that its pieces are on the rail or that they could not load. Its sizes are the rack's styles
// (`--garment-width` and `--rail-layout` in LandingView.styles.ts), read back here, so the breakpoints live in one place.
//
// The landing rail's player (owner, 4 November 2026), adapted from interactive-garment-starter by Amir Mušić (MIT
// License, Copyright (c) 2026 Amir Mušić), its `app.js`: pieces hang from the rod in profile; on a wide screen the one
// under the pointer turns to its front while its neighbours slide aside, and on a phone the row swipes with momentum and
// the piece that settles in the middle turns. A tap turns a piece again. While the rail is on screen it tours by itself:
// the piece in front turns, then the next comes to the front every beat; a touch, a hover or a key holds the tour for a
// while. The sprites load only once the rail nears the screen. Positions are set through the CSSOM (`style.left`),
// which the CSP allows; nothing is written as markup.

/** What the view renders and the player needs: each piece's sprite of `frames` frames in one row. */
export interface RailSprites {
  readonly sprites: ReadonlyArray<string>
  readonly frames: number
  readonly frameWidth: number
  readonly frameHeight: number
}

interface Piece {
  readonly button: HTMLElement
  readonly context: CanvasRenderingContext2D | null
  readonly head: Playhead
  sprite: HTMLImageElement | undefined
  position: number
  velocity: number
  frame: number
}

interface Drag {
  readonly id: number
  readonly startX: number
  readonly startY: number
  lastX: number
  lastTime: number
  velocity: number
  horizontal: boolean
}

interface State {
  readonly rack: HTMLElement
  readonly pieces: ReadonlyArray<Piece>
  readonly sprites: RailSprites
  ready: boolean
  active: number
  selected: number
  intent: ReturnType<typeof setTimeout> | undefined
  frame: number
  lastTime: number
  drag: Drag | undefined
  offset: number
  offsetVelocity: number
  quietClicksUntil: number
  touring: boolean
  tour: ReturnType<typeof setTimeout> | undefined
  rest: number
  inView: boolean
  /** The rack's layout, read from its styles at each layout. */
  phone: boolean
  width: number
}

const timing: TurnTiming = { turnMs: 900, returnMs: 500, endpointWindow: 0.3 }
const intentMs = 80
const tourBeat = 2200
/** A touch, a hover or a tap holds the tour for this many beats. */
const restBeats = 2

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The rack's layout as its styles set it for the screen: a phone's row that swipes, and each piece's width. */
const measured = (rack: HTMLElement) => {
  const styles = getComputedStyle(rack)
  return {
    phone: styles.getPropertyValue('--rail-layout').trim() === 'swipe',
    width: Number.parseFloat(styles.getPropertyValue('--garment-width')),
  }
}

const paint = (state: State, piece: Piece, frame: number) => {
  const { frameWidth, frameHeight } = state.sprites
  if (piece.sprite === undefined || piece.context === null) return
  piece.context.clearRect(0, 0, frameWidth, frameHeight)
  piece.context.drawImage(piece.sprite, frame * frameWidth, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight)
  piece.button.dataset['frame'] = String(frame)
}

const targets = (state: State) => {
  const width = state.rack.clientWidth
  const garmentWidth = state.width
  if (state.phone)
    return mobileRailPositions({
      width,
      halves: state.pieces.map((piece) => garmentWidth * (0.08 + 0.35 * piece.head.position)),
      focus: state.selected,
      offset: state.offset,
      gap: 12,
    })
  return rackPositions({ count: state.pieces.length, width, garmentWidth, active: state.active, minimumSpread: 35 })
}

const stepPieces = (state: State, dt: number) => {
  let moving = false
  for (const piece of state.pieces) {
    moving = advance(piece.head, dt, timing) || moving
    const frame = frameAt(piece.head, state.sprites.frames)
    if (frame !== piece.frame) {
      piece.frame = frame
      paint(state, piece, frame)
    }
  }
  const positions = targets(state)
  state.pieces.forEach((piece, index) => {
    const target = positions[index] ?? 0
    const next = reduced()
      ? { position: target, velocity: 0 }
      : slideStep(piece.position, piece.velocity, target, dt, state.active < 0 ? 22 : 20)
    piece.position = next.position
    piece.velocity = next.velocity
    piece.button.style.left = `${String(piece.position)}px`
    moving ||= Math.abs(piece.position - target) > 0.03 || Math.abs(piece.velocity) > 0.2
  })
  return moving
}

const tick = (state: State, time: number) => {
  const dt = state.lastTime > 0 ? Math.min(50, time - state.lastTime) : 0
  state.lastTime = time
  let moving = false
  if (state.phone && state.drag === undefined) {
    const next = slideStep(state.offset, state.offsetVelocity, 0, dt, 23)
    state.offset = next.position
    state.offsetVelocity = next.velocity
    moving = Math.abs(state.offset) > 0.03 || Math.abs(state.offsetVelocity) > 0.2
    if (!moving && state.active !== state.selected) intend(state, state.selected)
  }
  moving = stepPieces(state, dt) || moving
  if (moving) state.frame = requestAnimationFrame((next) => tick(state, next))
  else {
    state.frame = 0
    state.lastTime = 0
  }
}

const wake = (state: State) => {
  if (state.frame === 0 && !document.hidden) state.frame = requestAnimationFrame((time) => tick(state, time))
}

/** Turn `index` to its front and every other piece to its side; -1 turns them all to their sides. */
const activate = (state: State, index: number) => {
  if (!state.ready) return
  state.active = index
  state.pieces.forEach((piece, at) => {
    aim(piece.head, at === index ? 1 : 0, timing, reduced())
    piece.button.toggleAttribute('data-active', at === index)
  })
  if (index >= 0) state.selected = index
  wake(state)
}

const cancelIntent = (state: State) => {
  clearTimeout(state.intent)
  state.intent = undefined
}

/** Turn `index` after a moment, so a pointer passing over the rail does not set every piece spinning. */
function intend(state: State, index: number) {
  if (!state.ready || state.active === index) return
  cancelIntent(state)
  if (index < 0) return activate(state, -1)
  state.intent = setTimeout(() => activate(state, index), intentMs)
}

/** On a phone, bring `index` to the middle (it turns once the row settles); elsewhere turn it. */
const browse = (state: State, index: number) => {
  if (!state.ready) return
  const next = Math.max(0, Math.min(state.pieces.length - 1, index))
  cancelIntent(state)
  if (!state.phone) return activate(state, next)
  const positions = targets(state)
  state.offset = reduced() ? 0 : (positions[next] ?? 0) - state.rack.clientWidth / 2
  state.offsetVelocity = 0
  state.selected = next
  activate(state, -1)
}

const hold = (state: State) => {
  state.rest = restBeats
}

const advanceTour = (state: State) => {
  if (!state.touring) return
  if (state.rest > 0) state.rest -= 1
  else if (state.drag === undefined) browse(state, (state.selected + 1) % state.pieces.length)
  state.tour = setTimeout(() => advanceTour(state), tourBeat)
}

const startTour = (state: State) => {
  if (!state.ready || state.touring || reduced()) return
  state.touring = true
  cancelIntent(state)
  for (const piece of state.pieces) aim(piece.head, 0, timing, true)
  state.active = -1
  activate(state, state.selected)
  state.tour = setTimeout(() => advanceTour(state), tourBeat)
}

/** Off screen every piece goes back to its side, so the one in front turns again when the rail returns. */
const stopTour = (state: State) => {
  state.touring = false
  clearTimeout(state.tour)
  cancelIntent(state)
  if (!state.ready || reduced()) return
  for (const piece of state.pieces) aim(piece.head, 0, timing, true)
  state.active = -1
  wake(state)
}

/** Lay the pieces out for the screen's width, at once. */
const layout = (state: State) => {
  const { phone, width } = measured(state.rack)
  state.phone = phone
  state.width = width
  cancelIntent(state)
  state.drag = undefined
  state.offset = 0
  state.offsetVelocity = 0
  const positions = targets(state)
  state.pieces.forEach((piece, index) => {
    piece.position = positions[index] ?? 0
    piece.velocity = 0
    piece.button.style.left = `${String(piece.position)}px`
  })
  if (!state.touring) activate(state, state.phone ? state.selected : -1)
  wake(state)
}

const hitAt = (state: State, x: number) => {
  let nearest = -1
  let best = Number.POSITIVE_INFINITY
  state.pieces.forEach((piece, index) => {
    const distance = Math.abs(x - piece.position)
    const half = index === state.active ? state.width * 0.43 : 30
    if (distance <= half && distance < best) {
      nearest = index
      best = distance
    }
  })
  return nearest
}

const dragMove = (state: State, drag: Drag, event: PointerEvent) => {
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (!drag.horizontal && Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    drag.horizontal = true
    state.rack.setPointerCapture(event.pointerId)
    cancelIntent(state)
    activate(state, -1)
  }
  if (!drag.horizontal) return
  drag.velocity = (event.clientX - drag.lastX) / Math.max(1, event.timeStamp - drag.lastTime)
  drag.lastX = event.clientX
  drag.lastTime = event.timeStamp
  state.offset = dx
  state.offsetVelocity = 0
  wake(state)
}

const endDrag = (state: State, event: PointerEvent) => {
  const drag = state.drag
  if (drag?.id !== event.pointerId) return
  state.drag = undefined
  if (!drag.horizontal) return
  const width = state.rack.clientWidth
  const positions = targets(state)
  const next = swipeDestination({
    positions,
    width,
    focus: state.selected,
    delta: state.offset,
    velocity: drag.velocity,
  })
  state.offset = reduced() ? 0 : (positions[next] ?? 0) - width / 2
  state.offsetVelocity = 0
  state.selected = next
  state.quietClicksUntil = event.timeStamp + 450
  if (state.rack.hasPointerCapture(event.pointerId)) state.rack.releasePointerCapture(event.pointerId)
  wake(state)
}

const onPointerMove = (state: State, event: PointerEvent) => {
  if (!state.ready) return
  if (state.drag !== undefined && event.pointerId === state.drag.id) return dragMove(state, state.drag, event)
  if (state.phone || event.pointerType === 'touch') return
  hold(state)
  intend(state, hitAt(state, event.clientX - state.rack.getBoundingClientRect().left))
}

const onPointerDown = (state: State, event: PointerEvent) => {
  hold(state)
  if (!state.ready || !state.phone || event.button !== 0) return
  state.drag = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastTime: event.timeStamp,
    velocity: 0,
    horizontal: false,
  }
}

/** A tap brings a piece forward on a phone, and turns the one in front again. */
const onClick = (state: State, event: MouseEvent) => {
  if (!state.ready || event.timeStamp < state.quietClicksUntil || !(event.target instanceof Element)) return
  const button = event.target.closest('[data-rail-piece]')
  const index = state.pieces.findIndex((piece) => piece.button === button)
  if (index < 0) return
  hold(state)
  if (state.phone && index !== state.selected) return browse(state, index)
  const piece = state.pieces[index]
  if (piece !== undefined) aim(piece.head, 0, timing, true)
  state.active = -1
  activate(state, index)
}

const loadSprites = async (state: State, onLoaded: () => void) => {
  await Promise.all(
    state.pieces.map(async (piece, index) => {
      const sprite = new Image()
      sprite.src = state.sprites.sprites[index] ?? ''
      await sprite.decode()
      piece.sprite = sprite
      piece.frame = 0
      paint(state, piece, 0)
    }),
  )
  state.ready = true
  layout(state)
  if (state.inView) startTour(state)
  onLoaded()
}

const listen = (state: State, signal: AbortSignal) => {
  const { rack } = state
  rack.addEventListener('pointermove', (event) => onPointerMove(state, event), { signal })
  rack.addEventListener(
    'pointerleave',
    () => {
      if (!state.phone && state.drag === undefined && !state.touring) {
        cancelIntent(state)
        activate(state, -1)
      }
    },
    { signal },
  )
  rack.addEventListener('pointerdown', (event) => onPointerDown(state, event), { signal })
  rack.addEventListener('pointerup', (event) => endDrag(state, event), { signal })
  rack.addEventListener('pointercancel', () => ((state.drag = undefined), (state.offset = 0), wake(state)), { signal })
  rack.addEventListener('click', (event) => onClick(state, event), { signal })
  window.addEventListener('resize', () => layout(state), { signal })
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelIntent(state) : wake(state)), {
    signal,
  })
}

/** Play the rail inside `rack` (its pieces are the `[data-rail-piece]` buttons, each with a canvas) until the returned
 * function stops it; `onLoaded` runs once every sprite is on its canvas, `onFailed` if one of them cannot load. */
export const playRail = (
  rack: HTMLElement,
  sprites: RailSprites,
  onLoaded: () => void,
  onFailed: () => void,
): (() => void) => {
  const pieces = Array.from(rack.querySelectorAll<HTMLElement>('[data-rail-piece]'), (button) => ({
    button,
    context: button.querySelector('canvas')?.getContext('2d') ?? null,
    head: playhead(),
    sprite: undefined,
    position: 0,
    velocity: 0,
    frame: -1,
  }))
  const state: State = {
    rack,
    pieces,
    sprites,
    ready: false,
    active: -1,
    selected: 0,
    intent: undefined,
    frame: 0,
    lastTime: 0,
    drag: undefined,
    offset: 0,
    offsetVelocity: 0,
    quietClicksUntil: 0,
    touring: false,
    tour: undefined,
    rest: 0,
    inView: false,
    phone: false,
    width: 0,
  }
  const controller = new AbortController()
  listen(state, controller.signal)
  layout(state)
  let loading = false
  const near = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting !== true || loading) return
      loading = true
      // A sprite that does not load leaves the pieces in profile; the page hears of it, for telemetry.
      loadSprites(state, onLoaded).catch(onFailed)
    },
    { rootMargin: '150% 0px' },
  )
  const seen = new IntersectionObserver(
    ([entry]) => {
      state.inView = entry?.isIntersecting === true
      if (state.inView) startTour(state)
      else stopTour(state)
    },
    { threshold: 0.25 },
  )
  near.observe(rack)
  seen.observe(rack)
  return () => {
    controller.abort()
    near.disconnect()
    seen.disconnect()
    stopTour(state)
    cancelAnimationFrame(state.frame)
  }
}
