// The playhead of a turn, ported from Amir Mušić's interactive-garment-starter `src/controller.js` (MIT): eased,
// reversible, and retargeting from wherever it is, keeping its speed, so a second tap mid-turn turns it back smoothly.

/** A turn's playhead between the side view (0) and the front (1). */
export class TurnPlayhead {
  position: number
  target: number
  private velocity = 0
  private segment:
    | {
        readonly kind: 'brake'
        readonly start: number
        readonly velocity: number
        readonly duration: number
        elapsed: number
      }
    | {
        readonly kind: 'turn'
        readonly start: number
        readonly velocity: number
        readonly duration: number
        elapsed: number
      }
    | undefined

  constructor(
    private readonly durationMs: number,
    at: 0 | 1,
  ) {
    this.position = at
    this.target = at
  }

  /** Turn towards the side view or the front; at once when `immediate` (reduced motion). */
  turnTo(target: 0 | 1, immediate: boolean) {
    if (immediate) {
      this.target = target
      this.position = target
      this.velocity = 0
      this.segment = undefined
      return
    }
    if (target === this.target) return
    this.target = target
    if (this.velocity * (target - this.position) < 0) {
      // A short braking phase avoids a hard flip of direction during a partial turn.
      const room = this.velocity > 0 ? 1 - this.position : this.position
      const duration = Math.min(32, (2 * room) / Math.abs(this.velocity))
      this.segment = { kind: 'brake', start: this.position, velocity: this.velocity, duration, elapsed: 0 }
    } else this.tween()
  }

  private tween() {
    const distance = Math.abs(this.target - this.position)
    if (distance < 1e-9) {
      this.position = this.target
      this.velocity = 0
      this.segment = undefined
      return
    }
    let duration = Math.max(80, this.durationMs * Math.sqrt(distance))
    // Bound the Hermite tangent so a retarget in the same direction stays monotonic.
    if (this.velocity !== 0) duration = Math.min(duration, (3 * distance) / Math.abs(this.velocity))
    this.segment = { kind: 'turn', start: this.position, velocity: this.velocity, duration, elapsed: 0 }
  }

  /** Advance by `deltaMs`; whether it is still moving. */
  step(deltaMs: number) {
    let remaining = Math.min(Math.max(0, deltaMs), 50)
    while (this.segment !== undefined && remaining > 0) {
      const segment = this.segment
      const dt = Math.min(remaining, segment.duration - segment.elapsed)
      segment.elapsed += dt
      remaining -= dt
      const t = segment.duration > 0 ? segment.elapsed / segment.duration : 1
      if (segment.kind === 'brake') {
        this.position = segment.start + segment.velocity * segment.duration * (t - (t * t) / 2)
        this.velocity = segment.velocity * (1 - t)
      } else {
        const delta = this.target - segment.start
        const tangent = segment.velocity * segment.duration
        this.position = segment.start + delta * (3 * t * t - 2 * t * t * t) + tangent * (t * t * t - 2 * t * t + t)
        this.velocity = (delta * (6 * t - 6 * t * t) + tangent * (3 * t * t - 4 * t + 1)) / segment.duration
      }
      this.position = Math.max(0, Math.min(1, this.position))
      if (segment.elapsed >= segment.duration) {
        this.velocity = 0
        if (segment.kind === 'brake') this.tween()
        else {
          this.position = this.target
          this.segment = undefined
        }
      }
    }
    return this.segment !== undefined
  }

  /** The frame of `frames` the playhead is on. */
  frame(frames: number) {
    return Math.round(this.position * (frames - 1))
  }
}
