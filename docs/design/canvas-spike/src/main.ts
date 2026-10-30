import { Array, Effect, Match, Option, Queue, Schema, Stream } from 'effect'
import { Command, Mount, Runtime, Subscription, type Update } from 'foldkit'
import * as Dom from 'foldkit/dom'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { format, type Locale as LocaleType, type MessageKey, pieceName, wardrobeKeys } from './i18n.ts'
import {
  BASE_SIZE,
  PAPER_WIDTH,
  Piece,
  Pointer,
  cornerReach,
  dragged,
  nudged,
  pinched,
  placed,
  raised,
  startingPieces,
  stressPieces,
  tidied,
  turned,
} from './table.ts'

const HISTORY_LIMIT = 40
const TABLE_STORAGE_KEY = 'styld-canvas-spike:table'
const LOCALE_STORAGE_KEY = 'styld-canvas-spike:locale'
const PRIMARY_BUTTON = 0

// MODEL

const Locale = Schema.Literals(['en', 'sl'])
const SaveState = Schema.Literals(['Saved', 'Saving', 'Failed'])

export const Gesture = defineTaggedUnion({
  Idle: {},
  Dragging: {
    id: Schema.String,
    isTouch: Schema.Boolean,
    start: Pointer,
    now: Pointer,
    from: Piece,
    before: Schema.Array(Piece),
  },
  Pinching: {
    id: Schema.String,
    startA: Pointer,
    startB: Pointer,
    a: Pointer,
    b: Pointer,
    from: Piece,
    before: Schema.Array(Piece),
  },
  Turning: {
    id: Schema.String,
    reachX: Schema.Number,
    reachY: Schema.Number,
    start: Pointer,
    from: Piece,
    before: Schema.Array(Piece),
  },
})
export type Gesture = typeof Gesture.Type

export const Model = Schema.Struct({
  locale: Locale,
  pieces: Schema.Array(Piece),
  maybeSelectedId: Schema.Option(Schema.String),
  gesture: Gesture,
  pxPerUnit: Schema.Number,
  past: Schema.Array(Schema.Array(Piece)),
  future: Schema.Array(Schema.Array(Piece)),
  saveState: SaveState,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedDetermineLocale: { locale: Locale },
  CompletedApplyLocale: {},
  CompletedLoadTable: { pieces: Schema.Array(Piece) },
  FailedLoadTable: {},
  CompletedSaveTable: {},
  FailedSaveTable: {},
  MeasuredPaper: { width: Schema.Number },
  PressedPiece: { id: Schema.String, pointer: Pointer, isTouch: Schema.Boolean },
  PressedHandle: { id: Schema.String, pointer: Pointer },
  PressedPaper: { pointer: Pointer },
  MovedPointer: { pointer: Pointer },
  ReleasedPointer: { pointerId: Schema.Number },
  FocusedPiece: { id: Schema.String },
  PressedPieceKey: { id: Schema.String, key: Schema.String, isShifted: Schema.Boolean },
  PressedUndoKey: {},
  PressedRedoKey: {},
  PressedEscape: {},
  ClickedUndo: {},
  ClickedRedo: {},
  ClickedTidy: {},
  ClickedStartOver: {},
  ClickedStress: {},
  ClickedRemove: { id: Schema.String },
  ClickedWardrobePiece: { key: Schema.String },
  ClickedLocale: { locale: Locale },
})
export type Message = typeof Message.Type

type UpdateReturn = Update.Return<Model, Message>

// COMMAND

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const DetermineLocale = Command.define('DetermineLocale', {
  messages: [Message.CompletedDetermineLocale],
  execute: Effect.sync(() => {
      const preferred =
        new URLSearchParams(location.search).get('lang') ?? readStorage(LOCALE_STORAGE_KEY) ?? navigator.language
      return Message.CompletedDetermineLocale({ locale: preferred.toLowerCase().startsWith('sl') ? 'sl' : 'en' })
    }),
})

export const ApplyLocale = Command.define('ApplyLocale', {
  args: { locale: Locale },
  messages: [Message.CompletedApplyLocale],
  execute: ({ locale }) =>
    Effect.sync(() => {
      document.documentElement.lang = locale
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale)
      } catch {
        // NOTE: a private window refuses storage; the language still applies to this visit.
      }
      return Message.CompletedApplyLocale()
    }),
})

export const LoadTable = Command.define('LoadTable', {
  messages: [Message.CompletedLoadTable, Message.FailedLoadTable],
  execute: Effect.try({
      try: () => Schema.decodeUnknownSync(Schema.Array(Piece))(JSON.parse(readStorage(TABLE_STORAGE_KEY) ?? 'null')),
      catch: () => 'NoSavedTable',
    }).pipe(
      Effect.map((pieces) => Message.CompletedLoadTable({ pieces })),
      Effect.catch(() => Effect.succeed(Message.FailedLoadTable())),
    ),
})

export const SaveTable = Command.define('SaveTable', {
  args: { pieces: Schema.Array(Piece) },
  messages: [Message.CompletedSaveTable, Message.FailedSaveTable],
  execute: ({ pieces }) =>
    Effect.try({
      try: () => localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(pieces)),
      catch: () => 'StorageRefused',
    }).pipe(
      Effect.as(Message.CompletedSaveTable()),
      Effect.catch(() => Effect.succeed(Message.FailedSaveTable())),
    ),
})

// MOUNT

/** Reports the paper's width whenever it changes, so pointer travel in pixels converts to table units. */
export const MeasurePaper = Mount.defineStream('MeasurePaper', {
  messages: [Message.MeasuredPaper],
  execute: ({ element }) =>
    Stream.callback<typeof Message.MeasuredPaper.Type>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? 0
            if (width > 0) {
              Queue.offerUnsafe(queue, Message.MeasuredPaper({ width }))
            }
          })
          observer.observe(element)
          return observer
        }),
        (observer) => Effect.sync(() => observer.disconnect()),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
})

// UPDATE

const samePieces = (left: ReadonlyArray<Piece>, right: ReadonlyArray<Piece>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const findPiece = (pieces: ReadonlyArray<Piece>, id: string): Option.Option<Piece> =>
  Array.findFirst(pieces, (piece) => piece.id === id)

const withPiece = (pieces: ReadonlyArray<Piece>, next: Piece): ReadonlyArray<Piece> =>
  Array.map(pieces, (piece) => (piece.id === next.id ? next : piece))

/** One finished change: the table takes `pieces`, the previous table becomes an undo step, and it is saved. */
const committed = (model: Model, before: ReadonlyArray<Piece>, pieces: ReadonlyArray<Piece>): UpdateReturn => {
  const settled = modifyFields(model, { pieces: () => pieces, gesture: () => Gesture.Idle() })
  if (samePieces(before, pieces)) {
    return { model: settled }
  }
  return {
    model: modifyFields(settled, {
      past: (past) => Array.takeRight(Array.append(past, before), HISTORY_LIMIT),
      future: () => [],
      saveState: () => 'Saving',
    }),
    commands: [SaveTable({ pieces })],
  }
}

const selectionAfter = (model: Model, pieces: ReadonlyArray<Piece>): Option.Option<string> =>
  Option.filter(model.maybeSelectedId, (id) => Option.isSome(findPiece(pieces, id)))

const travelled = (model: Model, pieces: ReadonlyArray<Piece>, past: ReadonlyArray<ReadonlyArray<Piece>>, future: ReadonlyArray<ReadonlyArray<Piece>>): UpdateReturn => ({
  model: modifyFields(model, {
    pieces: () => pieces,
    past: () => past,
    future: () => future,
    gesture: () => Gesture.Idle(),
    maybeSelectedId: () => selectionAfter(model, pieces),
    saveState: () => 'Saving',
  }),
  commands: [SaveTable({ pieces })],
})

const undone = (model: Model): UpdateReturn =>
  Option.match(Array.last(model.past), {
    onNone: () => ({ model }),
    onSome: (previous) =>
      travelled(model, previous, Array.dropRight(model.past, 1), Array.prepend(model.future, model.pieces)),
  })

const redone = (model: Model): UpdateReturn =>
  Option.match(Array.head(model.future), {
    onNone: () => ({ model }),
    onSome: (next) => travelled(model, next, Array.append(model.past, model.pieces), Array.drop(model.future, 1)),
  })

/** A second finger while one is already dragging turns the drag into a pinch on the same piece. */
const pinchStarted = (model: Model, drag: typeof Gesture.Dragging.Type, pointer: Pointer): UpdateReturn => {
  if (!drag.isTouch || drag.now.pointerId === pointer.pointerId) {
    return { model }
  }
  return Option.match(findPiece(model.pieces, drag.id), {
    onNone: () => ({ model }),
    onSome: (from) => ({
      model: modifyFields(model, {
        gesture: () =>
          Gesture.Pinching({ id: drag.id, startA: drag.now, startB: pointer, a: drag.now, b: pointer, from, before: drag.before }),
      }),
    }),
  })
}

const pieceKeyChange = (key: string, isShifted: boolean) => {
  const step = isShifted ? 50 : 10
  const turnStep = isShifted ? 15 : 5
  return Match.value(key).pipe(
    Match.withReturnType<Option.Option<Partial<Pick<Piece, 'x' | 'y' | 'size' | 'turn'>>>>(),
    Match.when('ArrowLeft', () => Option.some({ x: -step })),
    Match.when('ArrowRight', () => Option.some({ x: step })),
    Match.when('ArrowUp', () => Option.some({ y: -step })),
    Match.when('ArrowDown', () => Option.some({ y: step })),
    Match.whenOr('+', '=', () => Option.some({ size: step * 4 })),
    Match.whenOr('-', '_', () => Option.some({ size: -step * 4 })),
    Match.when('[', () => Option.some({ turn: -turnStep })),
    Match.when(']', () => Option.some({ turn: turnStep })),
    Match.orElse(() => Option.none()),
  )
}

const removed = (model: Model, id: string): UpdateReturn => {
  const removal = committed(
    model,
    model.pieces,
    Array.filter(model.pieces, (piece) => piece.id !== id),
  )
  return { ...removal, model: modifyFields(removal.model, { maybeSelectedId: () => Option.none() }) }
}

const replaced = (model: Model, pieces: ReadonlyArray<Piece>): UpdateReturn => {
  const replacement = committed(model, model.pieces, pieces)
  return { ...replacement, model: modifyFields(replacement.model, { maybeSelectedId: () => Option.none() }) }
}

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedDetermineLocale: ({ locale }) => ({
      model: modifyFields(model, { locale: () => locale }),
      commands: [ApplyLocale({ locale })],
    }),
    CompletedApplyLocale: () => ({ model }),
    CompletedLoadTable: ({ pieces }) => ({ model: modifyFields(model, { pieces: () => pieces }) }),
    FailedLoadTable: () => ({ model }),
    CompletedSaveTable: () => ({ model: modifyFields(model, { saveState: () => 'Saved' }) }),
    FailedSaveTable: () => ({ model: modifyFields(model, { saveState: () => 'Failed' }) }),
    MeasuredPaper: ({ width }) => ({ model: modifyFields(model, { pxPerUnit: () => width / PAPER_WIDTH }) }),

    PressedPiece: ({ id, pointer, isTouch }) =>
      Gesture.match(model.gesture, {
        Idle: () => {
          const pieces = raised(model.pieces, id)
          return Option.match(findPiece(pieces, id), {
            onNone: () => ({ model }),
            onSome: (from) => ({
              model: modifyFields(model, {
                pieces: () => pieces,
                maybeSelectedId: () => Option.some(id),
                gesture: () => Gesture.Dragging({ id, isTouch, start: pointer, now: pointer, from, before: model.pieces }),
              }),
            }),
          })
        },
        Dragging: (drag) => pinchStarted(model, drag, pointer),
        Pinching: () => ({ model }),
        Turning: () => ({ model }),
      }),

    PressedHandle: ({ id, pointer }) =>
      Gesture.match(model.gesture, {
        Idle: () =>
          Option.match(findPiece(model.pieces, id), {
            onNone: () => ({ model }),
            onSome: (from) => {
              const reach = cornerReach(from, model.pxPerUnit)
              return {
                model: modifyFields(model, {
                  gesture: () =>
                    Gesture.Turning({ id, reachX: reach.x, reachY: reach.y, start: pointer, from, before: model.pieces }),
                }),
              }
            },
          }),
        Dragging: () => ({ model }),
        Pinching: () => ({ model }),
        Turning: () => ({ model }),
      }),

    PressedPaper: ({ pointer }) =>
      Gesture.match(model.gesture, {
        Idle: () => ({ model: modifyFields(model, { maybeSelectedId: () => Option.none() }) }),
        Dragging: (drag) => pinchStarted(model, drag, pointer),
        Pinching: () => ({ model }),
        Turning: () => ({ model }),
      }),

    MovedPointer: ({ pointer }) =>
      Gesture.match(model.gesture, {
        Idle: () => ({ model }),
        Dragging: (drag) =>
          drag.now.pointerId !== pointer.pointerId
            ? { model }
            : {
                model: modifyFields(model, {
                  gesture: () => modifyFields(drag, { now: () => pointer }),
                  pieces: (pieces) => withPiece(pieces, dragged(drag.from, drag.start, pointer, model.pxPerUnit)),
                }),
              },
        Pinching: (pinch) => {
          const a = pinch.a.pointerId === pointer.pointerId ? pointer : pinch.a
          const b = pinch.b.pointerId === pointer.pointerId ? pointer : pinch.b
          if (a === pinch.a && b === pinch.b) {
            return { model }
          }
          return {
            model: modifyFields(model, {
              gesture: () => modifyFields(pinch, { a: () => a, b: () => b }),
              pieces: (pieces) =>
                withPiece(pieces, pinched(pinch.from, pinch.startA, pinch.startB, a, b, model.pxPerUnit)),
            }),
          }
        },
        Turning: (turn) =>
          turn.start.pointerId !== pointer.pointerId
            ? { model }
            : {
                model: modifyFields(model, {
                  pieces: (pieces) =>
                    withPiece(pieces, turned(turn.from, { x: turn.reachX, y: turn.reachY }, turn.start, pointer)),
                }),
              },
      }),

    ReleasedPointer: ({ pointerId }) =>
      Gesture.match(model.gesture, {
        Idle: () => ({ model }),
        Dragging: (drag) => (drag.now.pointerId === pointerId ? committed(model, drag.before, model.pieces) : { model }),
        Pinching: (pinch) => {
          const remaining =
            pinch.a.pointerId === pointerId ? Option.some(pinch.b) : pinch.b.pointerId === pointerId ? Option.some(pinch.a) : Option.none()
          return Option.match(Option.all([remaining, findPiece(model.pieces, pinch.id)]), {
            onNone: () => ({ model }),
            onSome: ([pointer, from]) => ({
              model: modifyFields(model, {
                gesture: () =>
                  Gesture.Dragging({ id: pinch.id, isTouch: true, start: pointer, now: pointer, from, before: pinch.before }),
              }),
            }),
          })
        },
        Turning: (turn) => (turn.start.pointerId === pointerId ? committed(model, turn.before, model.pieces) : { model }),
      }),

    FocusedPiece: ({ id }) => ({ model: modifyFields(model, { maybeSelectedId: () => Option.some(id) }) }),

    PressedPieceKey: ({ id, key, isShifted }) => {
      if (model.gesture._tag !== 'Idle') {
        return { model }
      }
      if (key === 'Delete' || key === 'Backspace') {
        return removed(model, id)
      }
      return Option.match(Option.all([pieceKeyChange(key, isShifted), findPiece(model.pieces, id)]), {
        onNone: () => ({ model }),
        onSome: ([change, piece]) => {
          const step = committed(model, model.pieces, withPiece(model.pieces, nudged(piece, change)))
          return { ...step, model: modifyFields(step.model, { maybeSelectedId: () => Option.some(id) }) }
        },
      })
    },

    PressedUndoKey: () => undone(model),
    PressedRedoKey: () => redone(model),
    PressedEscape: () =>
      Gesture.match(model.gesture, {
        Idle: () => ({ model: modifyFields(model, { maybeSelectedId: () => Option.none() }) }),
        Dragging: (drag) => ({ model: modifyFields(model, { pieces: () => drag.before, gesture: () => Gesture.Idle() }) }),
        Pinching: (pinch) => ({ model: modifyFields(model, { pieces: () => pinch.before, gesture: () => Gesture.Idle() }) }),
        Turning: (turn) => ({ model: modifyFields(model, { pieces: () => turn.before, gesture: () => Gesture.Idle() }) }),
      }),

    ClickedUndo: () => undone(model),
    ClickedRedo: () => redone(model),
    ClickedTidy: () => committed(model, model.pieces, tidied(model.pieces)),
    ClickedStartOver: () => replaced(model, startingPieces),
    ClickedStress: () => replaced(model, stressPieces),
    ClickedRemove: ({ id }) => removed(model, id),
    ClickedWardrobePiece: ({ key }) => {
      const onTable = Array.filter(model.pieces, (piece) => piece.key === key)
      if (Array.isReadonlyArrayNonEmpty(onTable)) {
        return replaced(model, Array.filter(model.pieces, (piece) => piece.key !== key))
      }
      const wardrobeKey = Array.findFirst(wardrobeKeys, (known) => known === key)
      return Option.match(wardrobeKey, {
        onNone: () => ({ model }),
        onSome: (known) => {
          const piece = placed(model.pieces, known)
          const addition = committed(model, model.pieces, Array.append(model.pieces, piece))
          return { ...addition, model: modifyFields(addition.model, { maybeSelectedId: () => Option.some(piece.id) }) }
        },
      })
    },
    ClickedLocale: ({ locale }) => ({
      model: modifyFields(model, { locale: () => locale }),
      commands: [ApplyLocale({ locale })],
    }),
  })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    locale: 'en',
    pieces: startingPieces,
    maybeSelectedId: Option.none(),
    gesture: Gesture.Idle(),
    pxPerUnit: 0.36,
    past: [],
    future: [],
    saveState: 'Saved',
  },
  commands: [DetermineLocale(), LoadTable()],
})

// SUBSCRIPTION

const pointerOf = (event: PointerEvent): Pointer => ({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  documentPointer: entry(
    { isActive: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isActive: model.gesture._tag !== 'Idle' }),
      dependenciesToStream: ({ isActive }) =>
        Stream.when(
          Stream.mergeAll<Message, never, never>(
            [
              Stream.fromEventListener<PointerEvent>(document, 'pointermove').pipe(
                Stream.map((event) => Message.MovedPointer({ pointer: pointerOf(event) })),
              ),
              Stream.fromEventListener<PointerEvent>(document, 'pointerup').pipe(
                Stream.map((event) => Message.ReleasedPointer({ pointerId: event.pointerId })),
              ),
              Stream.fromEventListener<PointerEvent>(document, 'pointercancel').pipe(
                Stream.map((event) => Message.ReleasedPointer({ pointerId: event.pointerId })),
              ),
            ],
            { concurrency: 'unbounded' },
          ),
          Effect.sync(() => isActive),
        ),
    },
  ),

  documentKeys: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Dom.streamFromEventFilterMapPreventDefault({
          target: document,
          type: 'keydown',
          filterMapEvent: (event) => {
            const isCommand = event.metaKey || event.ctrlKey
            if (isCommand && event.key.toLowerCase() === 'z') {
              return Option.some(event.shiftKey ? Message.PressedRedoKey() : Message.PressedUndoKey())
            }
            if (event.key === 'Escape') {
              return Option.some(Message.PressedEscape())
            }
            return Option.none()
          },
        }),
    },
  ),
}))

// VIEW

type Translate = (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string

const pieceSrc = (key: string): string => `${import.meta.env.BASE_URL}pieces/${key}.webp`

const heldId = (gesture: Gesture): Option.Option<string> =>
  Gesture.match(gesture, {
    Idle: () => Option.none(),
    Dragging: ({ id }) => Option.some(id),
    Pinching: ({ id }) => Option.some(id),
    Turning: ({ id }) => Option.some(id),
  })

const classes = (...names: ReadonlyArray<string | false>): string => Array.filter(names, (name) => name !== false).join(' ')

const handledPieceKeys: ReadonlySet<string> = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', '[', ']', 'Delete', 'Backspace',
])

const handleView = (piece: Piece, t: Translate, h: HtmlBuilder<Message>): Html =>
  h.span([
    h.Class('handle'),
    h.AriaHidden(true),
    h.Title(t('table.turnHandle')),
    h.OnPointerDown((_pointerType, button, _screenX, _screenY, _timeStamp, clientX, clientY, pointerId) =>
      button === PRIMARY_BUTTON
        ? Option.some(Message.PressedHandle({ id: piece.id, pointer: { pointerId, x: clientX, y: clientY } }))
        : Option.none(),
    ),
  ])

const pieceView = (model: Model, piece: Piece, t: Translate, h: HtmlBuilder<Message>): Html => {
  const isSelected = Option.exists(model.maybeSelectedId, (id) => id === piece.id)
  const isHeld = Option.exists(heldId(model.gesture), (id) => id === piece.id)
  return h.keyed('div')(
    piece.id,
    [
      h.Class(classes('piece', isSelected && 'is-selected', isHeld && 'is-held')),
      h.Role('button'),
      h.Tabindex(0),
      h.AriaLabel(pieceName(model.locale, piece.key)),
      h.AriaPressed(isSelected ? 'true' : 'false'),
      h.AriaDescribedBy('keys-hint'),
      h.Style({
        '--x': String(piece.x),
        '--y': String(piece.y),
        '--k': String(piece.size / BASE_SIZE),
        '--r': `${String(piece.turn)}deg`,
        zIndex: String(piece.z),
      }),
      h.OnPointerDown((pointerType, button, _screenX, _screenY, _timeStamp, clientX, clientY, pointerId) =>
        button === PRIMARY_BUTTON
          ? Option.some(
              Message.PressedPiece({
                id: piece.id,
                pointer: { pointerId, x: clientX, y: clientY },
                isTouch: pointerType === 'touch',
              }),
            )
          : Option.none(),
      ),
      h.OnFocus(Message.FocusedPiece({ id: piece.id })),
      h.OnKeyDownPreventDefault((key, modifiers) =>
        handledPieceKeys.has(key) && !modifiers.metaKey && !modifiers.ctrlKey
          ? Option.some(Message.PressedPieceKey({ id: piece.id, key, isShifted: modifiers.shiftKey }))
          : Option.none(),
      ),
    ],
    [
      h.img([h.Class('cut'), h.Src(pieceSrc(piece.key)), h.Alt(''), h.Draggable(false)]),
      isSelected ? handleView(piece, t, h) : h.empty,
    ],
  )
}

const localeView = (model: Model, t: Translate, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('seg'), h.Role('group'), h.AriaLabel(t('table.language'))],
    Array.map(
      [
        { locale: 'en', label: 'English', short: 'EN' },
        { locale: 'sl', label: 'Slovenščina', short: 'SL' },
      ] satisfies ReadonlyArray<{ locale: LocaleType; label: string; short: string }>,
      ({ locale, label, short }) =>
        h.button(
          [
            h.Type('button'),
            h.Class(classes('seg-option', model.locale === locale && 'is-on')),
            h.AriaPressed(model.locale === locale ? 'true' : 'false'),
            h.AriaLabel(label),
            h.Lang(locale),
            h.OnClick(Message.ClickedLocale({ locale })),
          ],
          [short],
        ),
    ),
  )

const toolButton = (label: string, message: Message, isDisabled: boolean, h: HtmlBuilder<Message>): Html =>
  h.button([h.Type('button'), h.Class('tool'), h.Disabled(isDisabled), h.OnClick(message)], [label])

const toolbarView = (model: Model, t: Translate, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('tools')],
    [
      toolButton(t('table.undo'), Message.ClickedUndo(), Array.isReadonlyArrayEmpty(model.past), h),
      toolButton(t('table.redo'), Message.ClickedRedo(), Array.isReadonlyArrayEmpty(model.future), h),
      toolButton(t('table.tidy'), Message.ClickedTidy(), Array.isReadonlyArrayEmpty(model.pieces), h),
      toolButton(t('table.startOver'), Message.ClickedStartOver(), false, h),
    ],
  )

const selectionView = (model: Model, t: Translate, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('selection')],
    [
      Option.match(Option.flatMap(model.maybeSelectedId, (id) => findPiece(model.pieces, id)), {
        onNone: () => h.p([h.Class('count'), h.AriaLive('polite')], [t('table.count', { count: model.pieces.length })]),
        onSome: (piece) =>
          h.button(
            [h.Type('button'), h.Class('remove'), h.OnClick(Message.ClickedRemove({ id: piece.id }))],
            [t('table.remove', { name: pieceName(model.locale, piece.key) })],
          ),
      }),
      h.p(
        [h.Class(classes('saved', model.saveState === 'Failed' && 'is-failed'))],
        [
          Match.value(model.saveState).pipe(
            Match.when('Saved', () => t('table.saved')),
            Match.when('Saving', () => t('table.unsaved')),
            Match.when('Failed', () => t('table.saveFailed')),
            Match.exhaustive,
          ),
        ],
      ),
    ],
  )

const trayView = (model: Model, t: Translate, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('tray'), h.AriaLabelledBy('tray-title')],
    [
      h.h2([h.Id('tray-title'), h.Class('tray-title')], [t('table.wardrobe')]),
      h.ul(
        [h.Class('tray-list')],
        Array.map(wardrobeKeys, (key) => {
          const isOnTable = Array.some(model.pieces, (piece) => piece.key === key)
          const name = pieceName(model.locale, key)
          return h.keyed('li')(
            key,
            [],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class(classes('tray-piece', isOnTable && 'is-on')),
                  h.AriaPressed(isOnTable ? 'true' : 'false'),
                  h.AriaLabel(isOnTable ? t('table.takeOff', { name }) : t('table.add', { name })),
                  h.OnClick(Message.ClickedWardrobePiece({ key })),
                ],
                [h.img([h.Src(pieceSrc(key)), h.Alt(''), h.Draggable(false)]), h.span([h.Class('tray-name')], [name])],
              ),
            ],
          )
        }),
      ),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const t: Translate = (key, values) => format(model.locale, key, values)
  return {
    title: `${t('table.title')}, Styld`,
    body: h.main(
      [h.Class('page')],
      [
        h.header(
          [h.Class('head')],
          [h.h1([h.Class('title')], [t('table.title')]), localeView(model, t, h)],
        ),
        h.p([h.Class('hint')], [t('table.hint')]),
        h.div(
          [h.Class('stage')],
          [
            h.div(
              [h.Class('board')],
              [
                toolbarView(model, t, h),
                h.section(
                  [
                    h.Class('paper'),
                    h.AriaLabel(t('table.paper')),
                    h.OnMount(MeasurePaper()),
                    h.OnPointerDown((_pointerType, _button, _screenX, _screenY, _timeStamp, clientX, clientY, pointerId) =>
                      Option.some(Message.PressedPaper({ pointer: { pointerId, x: clientX, y: clientY } })),
                    ),
                  ],
                  Array.map(model.pieces, (piece) => pieceView(model, piece, t, h)),
                ),
                selectionView(model, t, h),
                h.p([h.Id('keys-hint'), h.Class('fine keys')], [t('table.keys')]),
              ],
            ),
            trayView(model, t, h),
          ],
        ),
        h.footer(
          [h.Class('foot')],
          [
            h.p([h.Class('fine')], [t('table.about')]),
            h.div(
              [h.Class('foot-links')],
              [
                h.button([h.Type('button'), h.Class('txt'), h.OnClick(Message.ClickedStress())], [t('table.stress')]),
                h.a([h.Class('txt'), h.Href('/')], [t('table.back')]),
              ],
            ),
          ],
        ),
      ],
    ),
  }
}
