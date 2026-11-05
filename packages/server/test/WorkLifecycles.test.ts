import { describe, expect, test } from '@effect/vitest'
import { firstTurnState, turnEnded, turnLifecycle } from '../src/capture/TurnLifecycle.ts'
import { Option } from 'effect'
import { firstTryOnState, runningTryOn, tryOnEnding, tryOnLifecycle } from '../src/generation/TryOnLifecycle.ts'

// The lifecycles of paid work on a piece or a photo: a piece's turn (`capture/TurnLifecycle.ts`) and a try-on
// (`generation/TryOnLifecycle.ts`). Each writer moves a row only along its table.

describe('a piece turn’s lifecycle', () => {
  const { canMove, moves } = turnLifecycle

  test('claims a request, hands it to the video model, waits for the frames and ends it', () => {
    expect(canMove('requested', 'anchoring')).toBe(true)
    expect(canMove('anchoring', 'generating')).toBe(true)
    expect(canMove('anchoring', 'requested')).toBe(true)
    expect(canMove('generating', 'video-ready')).toBe(true)
    for (const to of ['ready', 'rejected', 'failed'] as const) expect(canMove('video-ready', to)).toBe(true)
    // Given up from any step on the way.
    for (const from of ['requested', 'anchoring', 'generating', 'video-ready'] as const)
      expect(canMove(from, 'failed')).toBe(true)
  })

  test('refuses a turn that skips the video, or is kept before its frames', () => {
    expect(canMove('requested', 'generating')).toBe(false)
    expect(canMove('generating', 'ready')).toBe(false)
    expect(canMove('anchoring', 'video-ready')).toBe(false)
    expect(canMove('ready', 'anchoring')).toBe(false)
  })

  test('leaves an ended turn only by a new request', () => {
    for (const state of ['ready', 'rejected', 'failed'] as const) {
      expect(turnEnded(state)).toBe(true)
      expect(moves[state]).toEqual([firstTurnState])
    }
    expect(turnEnded('video-ready')).toBe(false)
  })
})

describe('a try-on’s lifecycle', () => {
  const { canMove, moves } = tryOnLifecycle

  test('admits a try-on once its credits are held, draws it once and ends it', () => {
    expect(firstTryOnState).toBe('admitting')
    expect(canMove('admitting', 'drawing')).toBe(true)
    expect(canMove('admitting', 'failed')).toBe(true)
    for (const to of ['done', 'refused', 'failed'] as const) expect(canMove('drawing', to)).toBe(true)
  })

  test('refuses a try-on drawn without its credits, and never moves one that ended', () => {
    expect(canMove('admitting', 'done')).toBe(false)
    expect(canMove('drawing', 'admitting')).toBe(false)
    for (const state of ['done', 'refused', 'failed'] as const) expect(moves[state]).toEqual([])
    expect(runningTryOn.every((state) => moves[state].length > 0)).toBe(true)
  })

  test('spends its credits once done, gives them back once refused or failed, and holds them while running', () => {
    expect(tryOnEnding('done')).toEqual(Option.some('succeeded'))
    expect(tryOnEnding('refused')).toEqual(Option.some('failed'))
    expect(tryOnEnding('failed')).toEqual(Option.some('failed'))
    for (const state of runningTryOn) expect(tryOnEnding(state)).toEqual(Option.none())
  })
})
