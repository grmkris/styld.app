import {
  type Board,
  BoardId,
  BoardImageId,
  type BoardItem,
  type BoardItemRefused,
  BoardName,
  type BoardNotFound,
  type BoardSummary,
  type BoardVersionConflict,
  boardHeight,
  boardWidth,
  LabelText,
  LookId,
  maximumBoardItems,
  Mood,
  maximumItemSize,
  minimumItemSize,
  OperationId,
  type OperationConflict,
  Paper,
  PieceId,
  type Pin,
  PinId,
  type PinRefused,
  pinsAtOnce,
  type ProfileNotPublished,
  TableLabel,
  TableLayout,
  TablePicture,
  TablePiece,
  type TableThing,
  TextStyle,
  type UploadRefused,
  UpdateBoard,
  Visibility,
  type WardrobeUnavailable,
} from '@styld/protocol'
import { Effect, Match, Schema } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import type { Boards } from '../boards/Boards.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { tool, ToolError } from './Tools.ts'
import { uploadFrom } from './WardrobeTools.ts'

type BoardFailure =
  | BoardNotFound
  | BoardVersionConflict
  | BoardItemRefused
  | PinRefused
  | OperationConflict
  | UploadRefused
  | ProfileNotPublished
  | WardrobeUnavailable

const refused = (code: string, message: string, recovery: string) =>
  new ToolError({ code, message, recovery, retryable: false })

const itemRefusals: Readonly<Record<BoardItemRefused['reason'], ToolError>> = {
  pieceNotFound: refused(
    'piece_not_found',
    'A piece on that table is neither in this wardrobe nor pinned on the board.',
    'Use piece ids from piece_search, or pin the piece first with pin_add.',
  ),
  imageNotFound: refused(
    'picture_not_found',
    'A picture on that table is not on this board.',
    'Use imageId values from board_get, or add the picture with picture_pin.',
  ),
  duplicateId: refused('duplicate', 'The table holds one thing twice.', 'Give each thing once.'),
  tableFull: refused(
    'table_full',
    `A table holds at most ${maximumBoardItems} things.`,
    'Take some off with collage_set first.',
  ),
}

const pinRefusals: Readonly<Record<PinRefused['reason'], ToolError>> = {
  pieceNotFound: refused('piece_not_found', 'One of those pieces is not in this wardrobe.', 'Call piece_search.'),
  lookNotFound: refused('look_not_found', 'One of those looks is not this account’s.', 'Call look_list.'),
  nothingToPin: refused('nothing_to_pin', 'There was nothing to pin.', 'Give pieceIds or lookIds.'),
  boardFull: refused('board_full', 'That would put more on the board than it holds.', 'Unpin something first.'),
}

/** Every board refusal as a tool error the assistant can act on. */
const asToolError = (error: BoardFailure): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      BoardNotFound: () =>
        refused('not_found', 'There is no board with that id for this account.', 'Call board_list to find it.'),
      BoardVersionConflict: ({ version }) =>
        new ToolError({
          code: 'version_conflict',
          message: `The table was saved elsewhere meanwhile; it is at version ${version} now.`,
          recovery: 'Call board_get, then set the table again from its version.',
          retryable: true,
        }),
      BoardItemRefused: ({ reason }) => itemRefusals[reason],
      PinRefused: ({ reason }) => pinRefusals[reason],
      OperationConflict: () =>
        refused(
          'operation_conflict',
          'That operationId was already used for a different change.',
          'Use a new operationId for a new change.',
        ),
      UploadRefused: () => refused('photo_refused', 'That picture could not be used.', 'Try another picture address.'),
      ProfileNotPublished: () =>
        refused(
          'profile_not_published',
          'A board goes public only from a published profile.',
          'Ask the person whether to publish their profile with profile_publish first.',
        ),
      WardrobeUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'Styld could not reach the boards just now.',
          recovery: 'Try again in a moment.',
          retryable: true,
        }),
    }),
  )

/** A pin as assistants see it: what it holds and its page, never an image address. */
const shownPin = (origin: string) => (pin: Pin) =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: ({ id, piece, addedAt }) => ({
        pinId: id,
        kind: 'piece' as const,
        piece: {
          id: piece.id,
          name: piece.name,
          category: piece.category,
          colours: piece.colours,
          url: `${origin}/wardrobe/${piece.id}`,
        },
        addedAt,
      }),
      PicturePin: ({ id, imageId, addedAt }) => ({ pinId: id, kind: 'picture' as const, imageId, addedAt }),
      LookPin: ({ id, look, addedAt }) => ({
        pinId: id,
        kind: 'look' as const,
        look: {
          id: look.id,
          name: look.name,
          pieceIds: look.pieces.map((piece) => piece.id),
          url: `${origin}/looks/${look.id}`,
        },
        addedAt,
      }),
    }),
  )

/** What lies on the table, bottom of the stack first, without the editor's ids. */
const shownItem = (item: BoardItem) => {
  const { x, y, size, turn, flipped } = item
  const at = { x, y, size, turn, flipped }
  return Match.value(item).pipe(
    Match.tagsExhaustive({
      PieceItem: ({ pieceId }) => ({ pieceId, ...at }),
      ImageItem: ({ imageId }) => ({ imageId, ...at }),
      TextItem: ({ text, style }) => ({ text, style, ...at }),
    }),
  )
}

const shownBoard = (origin: string) => (board: Board) => ({
  id: board.id,
  name: board.name,
  paper: board.paper,
  moods: board.moods,
  version: board.version,
  visibility: board.visibility,
  check: board.check,
  url: `${origin}/boards/${board.id}`,
  pins: board.pins.map(shownPin(origin)),
  table: board.items.toSorted((a, b) => a.z - b.z).map(shownItem),
})

const shownSummary = (origin: string) => (board: BoardSummary) => ({
  id: board.id,
  name: board.name,
  pinCount: board.pinCount,
  onTable: board.items.length,
  visibility: board.visibility,
  updatedAt: board.updatedAt,
  url: `${origin}/boards/${board.id}`,
})

/** One thing for the table, flat: exactly one of a piece, a picture on the board, or a label's words. */
const ThingInput = Schema.Struct({
  pieceId: Schema.optionalKey(PieceId),
  imageId: Schema.optionalKey(BoardImageId),
  text: Schema.optionalKey(LabelText),
  style: Schema.optionalKey(TextStyle),
})
type ThingInput = typeof ThingInput.Type

const oneThing = refused(
  'invalid_arguments',
  'Each thing needs exactly one of pieceId, imageId or text.',
  'Give a pieceId, an imageId from board_get, or the text of a label.',
)

const thingOf = (input: {
  readonly [Field in keyof ThingInput]?: ThingInput[Field] | undefined
}): Effect.Effect<TableThing, ToolError> => {
  const given = [input.pieceId, input.imageId, input.text].filter((value) => value !== undefined)
  if (given.length !== 1) return Effect.fail(oneThing)
  if (input.pieceId !== undefined) return Effect.succeed(TablePiece.make({ pieceId: input.pieceId }))
  if (input.imageId !== undefined) return Effect.succeed(TablePicture.make({ imageId: input.imageId }))
  return Effect.succeed(TableLabel.make({ text: input.text ?? '', style: input.style ?? 'label' }))
}

const tableUnits = `The table is a sheet ${boardWidth} units wide and ${boardHeight} tall; x and y are a thing's centre, size its width (${minimumItemSize}–${maximumItemSize}), turn its rotation in degrees (−180 to 180).`

const readTools = (boards: Boards['Service'], origin: string) => [
  tool({
    name: 'board_list',
    title: 'Boards',
    description: 'The boards of this account, most recently changed first, with how many things are pinned on each.',
    parameters: Schema.Struct({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: () =>
      boards.listBoards().pipe(
        Effect.map((found) => ({ boards: found.map(shownSummary(origin)) })),
        Effect.mapError(asToolError),
      ),
  }),
  tool({
    name: 'board_get',
    title: 'One board',
    description: `One board: its pins (pieces, looks and pictures, newest first, each with a pinId), its table (what lies on its collage, bottom first) and its version. ${tableUnits}`,
    parameters: Schema.Struct({ boardId: BoardId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: ({ boardId }) =>
      boards.getBoard(boardId).pipe(Effect.map(shownBoard(origin)), Effect.mapError(asToolError)),
  }),
]

const boardTools = (boards: Boards['Service'], origin: string) => {
  const show = shownBoard(origin)
  return [
    tool({
      name: 'board_create',
      title: 'Start a board',
      description:
        'Start an empty board with a name. Choose a new `operationId` for each board; repeating a call with the same one returns the first board.',
      parameters: Schema.Struct({ operationId: OperationId, name: BoardName }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: (input) => boards.createBoard(input).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'board_update',
      title: 'Rename a board',
      description: `Rename a board, change its paper (${Paper.literals.join(', ')}) or set its moods for Explore (up to three of ${Mood.literals.join(', ')}). Fields left out stay as they are.`,
      parameters: Schema.Struct({ boardId: BoardId, ...UpdateBoard.fields }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: ({ boardId, ...changes }) =>
        boards.updateBoard(boardId, changes).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'board_publish',
      title: 'Make a board public or private',
      description:
        'Make a board public on the person’s published profile, at its link, or private again. Only when the person asks. Styld checks a public board before others see it: `check.state` is passed (shown everywhere), unsure (on the profile and its link only), failed (hidden from others, with a reason) or pending (being checked).',
      parameters: Schema.Struct({ boardId: BoardId, visibility: Visibility }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ boardId, visibility }) =>
        boards.setBoardVisibility(boardId, { visibility }).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'board_delete',
      title: 'Delete a board',
      description:
        'Delete a board with its pins, its collage and the pictures put on it. Pieces and looks stay. Ask the person first.',
      parameters: Schema.Struct({ boardId: BoardId }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: ({ boardId }) =>
        boards.deleteBoard(boardId).pipe(Effect.as({ deleted: true, boardId }), Effect.mapError(asToolError)),
    }),
  ]
}

const pinTools = (
  boards: Boards['Service'],
  wardrobe: Wardrobe['Service'],
  origin: string,
  http: HttpClient.HttpClient,
) => {
  const show = shownBoard(origin)
  return [
    tool({
      name: 'pin_add',
      title: 'Pin on a board',
      description: `Pin this account's pieces (from piece_search) and looks (from look_list) on a board, at most ${pinsAtOnce} at once, the first newest. What is pinned already stays. Pinning does not put anything on the collage. Choose a new \`operationId\` for each change.`,
      parameters: Schema.Struct({
        boardId: BoardId,
        operationId: OperationId,
        pieceIds: Schema.optionalKey(Schema.Array(PieceId).check(Schema.isMaxLength(pinsAtOnce))),
        lookIds: Schema.optionalKey(Schema.Array(LookId).check(Schema.isMaxLength(pinsAtOnce))),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: ({ boardId, ...input }) =>
        boards.addPins(boardId, input).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'pin_remove',
      title: 'Take pins off a board',
      description:
        'Take pins off a board by their pinId (from board_get); they leave its collage too. A picture taken off is deleted. Ask the person before taking pictures off.',
      parameters: Schema.Struct({
        boardId: BoardId,
        operationId: OperationId,
        pinIds: Schema.Array(PinId).check(Schema.isMinLength(1), Schema.isMaxLength(pinsAtOnce)),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: ({ boardId, ...input }) =>
        boards.removePins(boardId, input).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'picture_pin',
      title: 'Put a picture on a board',
      description:
        'Pin a picture from a public https address on a board, for mood and inspiration. It is pinned, not placed on the collage; place it with collage_arrange using the imageId board_get shows. Choose a new `operationId` for each picture.',
      parameters: Schema.Struct({
        boardId: BoardId,
        operationId: OperationId,
        imageUrl: Schema.String.check(Schema.isMaxLength(2048)),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ boardId, operationId, imageUrl }) =>
        Effect.gen(function* () {
          const uploadId = yield* uploadFrom(wardrobe, http, imageUrl)
          yield* boards.addBoardImage(boardId, { operationId, uploadId }).pipe(Effect.mapError(asToolError))
          return show(yield* boards.getBoard(boardId).pipe(Effect.mapError(asToolError)))
        }),
    }),
  ]
}

const collageTools = (boards: Boards['Service'], origin: string) => {
  const show = shownBoard(origin)
  return [
    tool({
      name: 'collage_arrange',
      title: 'Arrange a board’s collage',
      description: `Put things on a board's collage where the next ones land, then lay the collage out: \`keep\` leaves it, \`tidy\` puts everything on an even grid, \`outfit\` in an outfit's places (top, layer, bottom, shoes, an accessory). Each thing is one of a pieceId (the account's own, or pinned on the board; placing pins it), an imageId on the board, or a label's text (style \`label\` or \`headline\`). Choose a new \`operationId\` for each change.`,
      parameters: Schema.Struct({
        boardId: BoardId,
        operationId: OperationId,
        layout: TableLayout,
        add: Schema.optionalKey(Schema.Array(ThingInput).check(Schema.isMaxLength(20))),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: ({ boardId, operationId, layout, add }) =>
        Effect.gen(function* () {
          const things = yield* Effect.forEach(add ?? [], thingOf)
          return show(
            yield* boards
              .arrangeBoard(boardId, { operationId, layout, add: things })
              .pipe(Effect.mapError(asToolError)),
          )
        }),
    }),
    tool({
      name: 'collage_set',
      title: 'Lay out a board’s collage exactly',
      description: `Replace a board's collage with exactly these things, bottom of the stack first, from the \`version\` board_get showed. ${tableUnits} Each thing is exactly one of a pieceId, an imageId or a label's text. A conflict means the collage changed: read it again.`,
      parameters: Schema.Struct({
        boardId: BoardId,
        operationId: OperationId,
        version: Schema.Int,
        items: Schema.Array(
          Schema.Struct({
            ...ThingInput.fields,
            x: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: boardWidth })),
            y: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: boardHeight })),
            size: Schema.Finite.check(Schema.isBetween({ minimum: minimumItemSize, maximum: maximumItemSize })),
            turn: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 }))),
            flipped: Schema.optionalKey(Schema.Boolean),
          }),
        ).check(Schema.isMaxLength(maximumBoardItems)),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: ({ boardId, operationId, version, items }) =>
        Effect.gen(function* () {
          const placed = yield* Effect.forEach(items, ({ pieceId, imageId, text, style, ...at }) =>
            Effect.map(thingOf({ pieceId, imageId, text, style }), (thing) => ({ thing, ...at })),
          )
          return show(
            yield* boards.setTable(boardId, { operationId, version, items: placed }).pipe(Effect.mapError(asToolError)),
          )
        }),
    }),
  ]
}

/** Boards in the assistants: thin projections of the same `Boards` operations the website uses. */
export const boardMcpTools = (
  boards: Boards['Service'],
  wardrobe: Wardrobe['Service'],
  origin: string,
  http: HttpClient.HttpClient,
) => [
  ...readTools(boards, origin),
  ...boardTools(boards, origin),
  ...pinTools(boards, wardrobe, origin, http),
  ...collageTools(boards, origin),
]
