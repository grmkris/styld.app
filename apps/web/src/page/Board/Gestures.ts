import { Match, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { committed, findItem, type UpdateReturn, withItem } from './Edits.ts'
import { dragged, nudged, type Placement, type Pointer, pinched, raised, turned } from './Geometry.ts'
import type { KeyStep } from './Message.ts'
import { Gesture, type Model } from './Model.ts'

/** A press on an item picks it up: it comes to the top and follows the pointer. A second finger while one
 * is already moving it turns the move into a pinch. */
export const pressedItem = (model: Model, id: string, pointer: Pointer, isTouch: boolean): UpdateReturn =>
  Gesture.match(model.gesture, {
    Idle: () => {
      const items = raised(model.items, id)
      return Option.match(findItem(items, id), {
        onNone: () => ({ model }),
        onSome: (from) => ({
          model: modifyFields(model, {
            items: () => items,
            maybeSelectedId: () => Option.some(id),
            gesture: () => Gesture.Dragging({ id, isTouch, start: pointer, now: pointer, from, before: model.items }),
          }),
        }),
      })
    },
    Dragging: (drag) => pinchStarted(model, drag, pointer),
    Pinching: () => ({ model }),
    Turning: () => ({ model }),
  })

const pinchStarted = (model: Model, drag: typeof Gesture.Dragging.Type, pointer: Pointer): UpdateReturn => {
  if (!drag.isTouch || drag.now.pointerId === pointer.pointerId) return { model }
  return Option.match(findItem(model.items, drag.id), {
    onNone: () => ({ model }),
    onSome: (from) => ({
      model: modifyFields(model, {
        gesture: () =>
          Gesture.Pinching({
            id: drag.id,
            startA: drag.now,
            startB: pointer,
            a: drag.now,
            b: pointer,
            from,
            before: drag.before,
          }),
      }),
    }),
  })
}

/** The corner handle: the reach from the item's centre to the pointer sets its size and turn from here on. */
export const pressedHandle = (
  model: Model,
  id: string,
  pointer: Pointer,
  centerX: number,
  centerY: number,
): UpdateReturn => {
  if (!Gesture.guards.Idle(model.gesture)) return { model }
  return Option.match(findItem(model.items, id), {
    onNone: () => ({ model }),
    onSome: (from) => ({
      model: modifyFields(model, {
        maybeSelectedId: () => Option.some(id),
        gesture: () =>
          Gesture.Turning({
            id,
            reachX: pointer.x - centerX,
            reachY: pointer.y - centerY,
            start: pointer,
            from,
            before: model.items,
          }),
      }),
    }),
  })
}

/** A press on the empty paper puts the selection down, or adds the second finger of a pinch. */
export const pressedPaper = (model: Model, pointer: Pointer): UpdateReturn =>
  Gesture.match(model.gesture, {
    Idle: () => ({ model: modifyFields(model, { maybeSelectedId: () => Option.none() }) }),
    Dragging: (drag) => pinchStarted(model, drag, pointer),
    Pinching: () => ({ model }),
    Turning: () => ({ model }),
  })

const pinchMoved = (model: Model, pinch: typeof Gesture.Pinching.Type, pointer: Pointer): UpdateReturn => {
  const a = pinch.a.pointerId === pointer.pointerId ? pointer : pinch.a
  const b = pinch.b.pointerId === pointer.pointerId ? pointer : pinch.b
  if (a === pinch.a && b === pinch.b) return { model }
  return {
    model: modifyFields(model, {
      gesture: () => modifyFields(pinch, { a: () => a, b: () => b }),
      items: (items) => withItem(items, pinched(pinch.from, [pinch.startA, pinch.startB], [a, b], model.pxPerUnit)),
    }),
  }
}

export const movedPointer = (model: Model, pointer: Pointer): UpdateReturn =>
  Gesture.match(model.gesture, {
    Idle: () => ({ model }),
    Dragging: (drag) =>
      drag.now.pointerId === pointer.pointerId
        ? {
            model: modifyFields(model, {
              gesture: () => modifyFields(drag, { now: () => pointer }),
              items: (items) => withItem(items, dragged(drag.from, drag.start, pointer, model.pxPerUnit)),
            }),
          }
        : { model },
    Pinching: (pinch) => pinchMoved(model, pinch, pointer),
    Turning: (turn) =>
      turn.start.pointerId === pointer.pointerId
        ? {
            model: modifyFields(model, {
              items: (items) =>
                withItem(items, turned(turn.from, { x: turn.reachX, y: turn.reachY }, turn.start, pointer)),
            }),
          }
        : { model },
  })

/** Lifting one finger of a pinch carries on as a move with the other. */
const pinchReleased = (model: Model, pinch: typeof Gesture.Pinching.Type, pointerId: number): UpdateReturn => {
  const remaining =
    pinch.a.pointerId === pointerId
      ? Option.some(pinch.b)
      : pinch.b.pointerId === pointerId
        ? Option.some(pinch.a)
        : Option.none()
  return Option.match(Option.all([remaining, findItem(model.items, pinch.id)]), {
    onNone: () => ({ model }),
    onSome: ([pointer, from]) => ({
      model: modifyFields(model, {
        gesture: () =>
          Gesture.Dragging({ id: pinch.id, isTouch: true, start: pointer, now: pointer, from, before: pinch.before }),
      }),
    }),
  })
}

export const releasedPointer = (model: Model, pointerId: number): UpdateReturn =>
  Gesture.match(model.gesture, {
    Idle: () => ({ model }),
    Dragging: (drag) => (drag.now.pointerId === pointerId ? committed(model, drag.before, model.items) : { model }),
    Pinching: (pinch) => pinchReleased(model, pinch, pointerId),
    Turning: (turn) => (turn.start.pointerId === pointerId ? committed(model, turn.before, model.items) : { model }),
  })

/** Escape cancels a gesture in progress, or puts the selection down. */
export const pressedEscape = (model: Model): UpdateReturn => {
  const cancelled = (before: Model['items']) => ({
    model: modifyFields(model, { items: () => before, gesture: () => Gesture.Idle() }),
  })
  return Gesture.match(model.gesture, {
    Idle: () => ({ model: modifyFields(model, { maybeSelectedId: () => Option.none() }) }),
    Dragging: (drag) => cancelled(drag.before),
    Pinching: (pinch) => cancelled(pinch.before),
    Turning: (turn) => cancelled(turn.before),
  })
}

const keyChange = (step: KeyStep, isShifted: boolean): Partial<Placement> => {
  const distance = isShifted ? 50 : 10
  const angle = isShifted ? 15 : 5
  return Match.value(step).pipe(
    Match.withReturnType<Partial<Placement>>(),
    Match.when('left', () => ({ x: -distance })),
    Match.when('right', () => ({ x: distance })),
    Match.when('up', () => ({ y: -distance })),
    Match.when('down', () => ({ y: distance })),
    Match.when('bigger', () => ({ size: distance * 4 })),
    Match.when('smaller', () => ({ size: -distance * 4 })),
    Match.when('turnLeft', () => ({ turn: -angle })),
    Match.when('turnRight', () => ({ turn: angle })),
    Match.when('remove', () => ({})),
    Match.exhaustive,
  )
}

/** The keyboard moves, resizes and turns the focused item, each step its own undo step. */
export const keyed = (model: Model, id: string, step: KeyStep, isShifted: boolean): UpdateReturn => {
  if (!Gesture.guards.Idle(model.gesture)) return { model }
  return Option.match(findItem(model.items, id), {
    onNone: () => ({ model }),
    onSome: (item) =>
      committed(
        modifyFields(model, { maybeSelectedId: () => Option.some(id) }),
        model.items,
        withItem(model.items, nudged(item, keyChange(step, isShifted))),
      ),
  })
}
