// The landing rail's motion, with no DOM: a piece's eased, reversible turn between its side (0) and its front (1), and
// where each piece hangs on the rail. Adapted from interactive-garment-starter by Amir Mušić (MIT License, Copyright
// (c) 2026 Amir Mušić): its `controller.js`, `rack-layout.js` and `mobile-rail.js`, typed and split into small steps.

/** How a turn moves: the time to turn to the front, the time back to the side, and how much of each end is softened. */
export interface TurnTiming {
  readonly turnMs: number
  readonly returnMs: number
  readonly endpointWindow: number
}

interface Segment {
  readonly kind: 'brake' | 'turn'
  readonly start: number
  readonly velocity: number
  readonly duration: number
  elapsed: number
}

/** A piece's playhead: where its turn is (0 side, 1 front), where it is going and how fast. Changing the target keeps
 * the position and the velocity, so a turn reverses mid-way without a jump. */
export interface Playhead {
  position: number
  target: 0 | 1
  velocity: number
  segment: Segment | undefined
}

export const playhead = (): Playhead => ({ position: 0, target: 0, velocity: 0, segment: undefined })

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const tween = (head: Playhead, timing: TurnTiming) => {
  const distance = Math.abs(head.target - head.position)
  if (distance < 1e-9) {
    head.position = head.target
    head.velocity = 0
    head.segment = undefined
    return
  }
  const full = head.target === 1 ? timing.turnMs : timing.returnMs
  const eased = Math.max(80, full * Math.sqrt(distance))
  // Bound the Hermite tangent so a same-direction retarget stays monotonic.
  const duration = head.velocity === 0 ? eased : Math.min(eased, (3 * distance) / Math.abs(head.velocity))
  head.segment = { kind: 'turn', start: head.position, velocity: head.velocity, duration, elapsed: 0 }
}

/** Send the playhead towards the side or the front; `immediate` jumps there (reduced motion). */
export const aim = (head: Playhead, target: 0 | 1, timing: TurnTiming, immediate = false) => {
  if (immediate) {
    head.target = target
    head.position = target
    head.velocity = 0
    head.segment = undefined
    return
  }
  if (target === head.target) return
  head.target = target
  if (head.velocity * (target - head.position) < 0) {
    // A short braking phase avoids a hard velocity flip during a partial turn.
    const room = head.velocity > 0 ? 1 - head.position : head.position
    const duration = Math.min(32, (2 * room) / Math.abs(head.velocity))
    head.segment = { kind: 'brake', start: head.position, velocity: head.velocity, duration, elapsed: 0 }
  } else tween(head, timing)
}

const brakeAt = (segment: Segment, t: number) => ({
  position: segment.start + segment.velocity * segment.duration * (t - (t * t) / 2),
  velocity: segment.velocity * (1 - t),
})

const taper = (u: number, edge: number) => (u < edge ? u * u * (1 - u / edge) ** 3 : 0)
const taperSlope = (u: number, edge: number) => (u < edge ? u * (1 - u / edge) ** 2 * (2 - (5 * u) / edge) : 0)

const turnAt = (segment: Segment, target: number, t: number, edge: number) => {
  const delta = target - segment.start
  const tangent = segment.velocity * segment.duration
  const position = segment.start + delta * (3 * t * t - 2 * t * t * t) + tangent * (t * t * t - 2 * t * t + t)
  const velocity = (delta * (6 * t - 6 * t * t) + tangent * (3 * t * t - 4 * t + 1)) / segment.duration
  if (edge === 0) return { position, velocity }
  // Local corrections soften acceleration at rest, with no extra dwell or change to the middle of the turn.
  const start = -3 * delta + 2 * tangent
  const end = 3 * delta - tangent
  return {
    position: position + start * taper(t, edge) + end * taper(1 - t, edge),
    velocity: velocity + (start * taperSlope(t, edge) - end * taperSlope(1 - t, edge)) / segment.duration,
  }
}

const finish = (head: Playhead, segment: Segment, timing: TurnTiming) => {
  head.velocity = 0
  if (segment.kind === 'brake') tween(head, timing)
  else {
    head.position = head.target
    head.segment = undefined
  }
}

/** Move the playhead on by `deltaMs` (at most 50 ms at once); says whether it is still moving. */
export const advance = (head: Playhead, deltaMs: number, timing: TurnTiming): boolean => {
  let remaining = Math.min(Math.max(0, deltaMs), 50)
  while (head.segment !== undefined && remaining > 0) {
    const segment = head.segment
    const dt = Math.min(remaining, segment.duration - segment.elapsed)
    segment.elapsed += dt
    remaining -= dt
    const t = segment.duration > 0 ? segment.elapsed / segment.duration : 1
    const next = segment.kind === 'brake' ? brakeAt(segment, t) : turnAt(segment, head.target, t, timing.endpointWindow)
    head.position = clamp01(next.position)
    head.velocity = next.velocity
    if (segment.elapsed >= segment.duration) finish(head, segment, timing)
  }
  return head.segment !== undefined
}

/** The sprite frame the playhead shows. */
export const frameAt = (head: Playhead, frames: number) => Math.round(head.position * (frames - 1))

/** Critically damped motion towards `target`, keeping the velocity when the target changes. */
export const slideStep = (position: number, velocity: number, target: number, deltaMs: number, omega = 15) => {
  const dt = Math.min(deltaMs, 50) / 1000
  const offset = position - target
  const term = velocity + omega * offset
  const decay = Math.exp(-omega * dt)
  const next = target + (offset + term * dt) * decay
  const nextVelocity = (velocity - omega * term * dt) * decay
  if (Math.abs(next - target) < 0.03 && Math.abs(nextVelocity) < 0.2) return { position: target, velocity: 0 }
  return { position: next, velocity: nextVelocity }
}

/** Where each piece hangs on a wide rail: evenly spaced, and with one turned to the front, its neighbours moved aside
 * so it has room while its own point of suspension stays put. */
export const rackPositions = (rack: {
  readonly count: number
  readonly width: number
  readonly garmentWidth: number
  readonly active: number
  readonly minimumSpread: number
}): ReadonlyArray<number> => {
  const { count, width, garmentWidth, active, minimumSpread } = rack
  const pitch = width / count
  const rest = Array.from({ length: count }, (_, index) => (index + 0.5) * pitch)
  if (active < 0 || active >= count || count === 1) return rest
  const profileHalf = garmentWidth * 0.08
  const gap = garmentWidth * 0.51 + 14
  const centre = rest[active] ?? 0
  const positions = [...rest]
  for (const direction of [-1, 1] as const) {
    const neighbours = direction < 0 ? active : count - active - 1
    if (neighbours === 0) continue
    const room = direction < 0 ? centre - profileHalf : width - profileHalf - centre
    const separation = Math.min(Math.max(gap, pitch + minimumSpread), room)
    const neighbourPitch = neighbours > 1 ? Math.min(pitch, (room - separation) / (neighbours - 1)) : pitch
    for (let step = 1; step <= neighbours; step++)
      positions[active + direction * step] = centre + direction * (separation + (step - 1) * neighbourPitch)
  }
  return positions
}

/** Where each piece hangs on a phone's rail: the focused one in the middle (moved by the swipe's offset), the others
 * one after another with room for their silhouettes. */
export const mobileRailPositions = (rail: {
  readonly width: number
  readonly halves: ReadonlyArray<number>
  readonly focus: number
  readonly offset: number
  readonly gap: number
}): ReadonlyArray<number> => {
  const { width, halves, focus, offset, gap } = rail
  const pitch = width * 0.27
  const positions = halves.map(() => 0)
  positions[focus] = width / 2 + offset
  for (const direction of [-1, 1] as const)
    for (let index = focus + direction; index >= 0 && index < halves.length; index += direction) {
      const previous = index - direction
      positions[index] =
        (positions[previous] ?? 0) + direction * Math.max(pitch, (halves[previous] ?? 0) + (halves[index] ?? 0) + gap)
    }
  return positions
}

/** The piece a swipe settles on: the one nearest the middle, or the next one after a short deliberate flick. */
export const swipeDestination = (swipe: {
  readonly positions: ReadonlyArray<number>
  readonly width: number
  readonly focus: number
  readonly delta: number
  readonly velocity: number
}): number => {
  const { positions, width, focus, delta, velocity } = swipe
  const distanceFrom = (index: number) => Math.abs((positions[index] ?? 0) - width / 2)
  let nearest = focus
  for (let index = 0; index < positions.length; index++)
    if (distanceFrom(index) < distanceFrom(nearest)) nearest = index
  if (nearest === focus && Math.abs(delta) > 22 && Math.abs(velocity) > 0.35) nearest = focus + (delta < 0 ? 1 : -1)
  return Math.max(0, Math.min(positions.length - 1, nearest))
}
