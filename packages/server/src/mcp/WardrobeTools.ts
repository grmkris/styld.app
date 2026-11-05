import {
  AddPiece,
  AddPieceFromLink,
  CreateUpload,
  ImageType,
  Operation,
  OperationId,
  PieceFilter,
  type Piece,
  PieceId,
  UpdatePiece,
  DeletePieces,
  UploadId,
  maximumImageBytes,
  Url,
} from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { tool, ToolError, toolSpec } from './Tools.ts'
import type { Links } from '../links/Links.ts'

/** A piece as assistants see it: its fields and its page on the website, never an image address. */
const shown = (origin: string) => (piece: Piece) => ({ ...piece, url: `${origin}/wardrobe/${piece.id}` })

/** A page cursor of piece_search and wardrobe_show: where the next page starts among the matches. */
export const SearchCursor = Schema.String.check(Schema.isPattern(/^[0-9]{1,6}$/))

/** The wardrobe's search (`Wardrobe.searchPieces`, the website's own rules) as a page from a tool's cursor and limit. */
export const searchPage = (
  wardrobe: Pick<Wardrobe['Service'], 'searchPieces'>,
  { cursor, limit, ...filter }: PieceFilter & { readonly cursor?: string; readonly limit?: number },
  defaultLimit: number,
) =>
  wardrobe.searchPieces({ filter, offset: Number(cursor ?? '0'), limit: limit ?? defaultLimit }).pipe(
    Effect.map(({ pieces, total, nextOffset }) => ({
      pieces,
      total,
      nextCursor: Option.match(nextOffset, { onNone: () => null, onSome: String }),
    })),
  )

/** The piece's fields as the protocol defines them, so the website and assistants accept the same. */
const { operationId: _operationId, uploadId: _uploadId, ...PieceFields } = AddPiece.fields

const PieceAdd = Schema.Struct({
  operationId: OperationId,
  imageUrl: Schema.optionalKey(Url),
  uploadId: Schema.optionalKey(UploadId),
  ...PieceFields,
})

export const pieceSearch = toolSpec({
  name: 'piece_search',
  title: 'Search the wardrobe',
  description:
    'Ready pieces in the wardrobe, newest first, as the website finds them: every word of `q` must match the start of a word in their name, notes or brand, or their garment type, group or colours named in English or Slovenian; and by garment type, group, colour, season, occasion, pattern or brand. Returns up to `limit` pieces and a `nextCursor` for the next page (null on the last page).',
  parameters: Schema.Struct({
    ...PieceFilter.fields,
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
    cursor: Schema.optionalKey(SearchCursor),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

export const pieceGet = toolSpec({
  name: 'piece_get',
  title: 'One piece',
  description: 'One piece of the wardrobe by its id, with its link on the website.',
  parameters: Schema.Struct({ pieceId: PieceId }),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

const readTools = (wardrobe: Wardrobe['Service'], show: ReturnType<typeof shown>) => [
  tool({
    ...pieceSearch,
    handler: (input) =>
      searchPage(wardrobe, input, 20).pipe(
        Effect.map(({ pieces, nextCursor }) => ({ pieces: pieces.map(show), nextCursor })),
      ),
  }),
  tool({ ...pieceGet, handler: ({ pieceId }) => wardrobe.getPiece(pieceId).pipe(Effect.map(show)) }),
]

const writeTools = (
  wardrobe: Wardrobe['Service'],
  links: Links['Service'],
  show: ReturnType<typeof shown>,
  origin: string,
) => [
  tool({
    name: 'upload_create',
    title: 'Prepare a photo upload',
    description: `A one-time URL for a photo of a piece. PUT the image bytes to \`uploadUrl\` with its Content-Type within 15 minutes, then call piece_add with the \`uploadId\`. Accepts ${ImageType.literals.join(', ')} up to ${maximumImageBytes / 1024 / 1024} MB. The URL is a secret.`,
    parameters: CreateUpload,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (input) =>
      wardrobe
        .createUpload(input)
        .pipe(Effect.map(({ uploadId, path, expiresAt }) => ({ uploadId, uploadUrl: `${origin}${path}`, expiresAt }))),
  }),
  tool({
    name: 'piece_add',
    title: 'Add a piece',
    description:
      'Add a piece of clothing from a photo: either `imageUrl` (a public https address of the image) or an `uploadId` from upload_create. Choose a new `operationId` for each piece; repeating a call with the same one returns the first result instead of adding twice. The piece is `processing` for a few seconds, then `ready`: piece_show shows it.',
    parameters: PieceAdd,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: (input) =>
      Effect.gen(function* () {
        const { imageUrl, uploadId, ...fields } = input
        if (uploadId !== undefined && imageUrl === undefined)
          return show(yield* wardrobe.addPiece({ ...fields, uploadId }))
        if (imageUrl !== undefined && uploadId === undefined)
          return show(yield* links.addPieceFromPhoto({ ...fields, imageUrl }))
        return yield* new ToolError({
          code: 'invalid_arguments',
          message: 'Give exactly one of imageUrl or uploadId.',
          recovery: 'Pass imageUrl for a photo on the web, or uploadId after upload_create.',
          retryable: false,
        })
      }),
  }),
  tool({
    name: 'piece_update',
    title: 'Change a piece',
    description:
      'Change the name, notes, garment type, colours, season, occasions, pattern, brand or shop link of a piece. Fields left out stay as they are; null clears a name, notes, season, pattern, brand or shop link.',
    parameters: Schema.Struct({ pieceId: PieceId, ...UpdatePiece.fields }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: ({ pieceId, ...changes }) => wardrobe.updatePiece(pieceId, changes).pipe(Effect.map(show)),
  }),
  tool({
    name: 'piece_delete',
    title: 'Delete a piece',
    description:
      'Delete a piece and its photo from the wardrobe for good. Ask the person before deleting. Choose a new `operationId`.',
    parameters: Schema.Struct({ pieceId: PieceId, ...Operation.fields }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: ({ pieceId, operationId }) =>
      wardrobe.deletePiece(pieceId, operationId).pipe(Effect.as({ deleted: true, pieceId })),
  }),
  tool({
    name: 'pieces_delete',
    title: 'Delete several pieces',
    description:
      'Delete up to 50 pieces and their photos from the wardrobe at once, for good: they also leave the person’s looks, boards and photos. Ask the person before deleting, naming the pieces. A piece already deleted is skipped. Choose a new `operationId`.',
    parameters: DeletePieces,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: (input) => wardrobe.deletePieces(input).pipe(Effect.as({ deleted: true, pieceIds: input.pieceIds })),
  }),
]

/** Adding a piece from a shop's product page. */
const linkTools = (wardrobe: Wardrobe['Service'], links: Links['Service'], show: ReturnType<typeof shown>) => [
  tool({
    name: 'link_import',
    title: 'Add a piece from a link',
    description:
      'Add a piece from a shop’s product page: Styld reads the page’s picture and name and adds it straight to the wardrobe. Give the garment type; the name defaults to the page’s. Choose a new `operationId` for each piece. A shop that blocks reading answers `blocked`: then ask for a photo instead.',
    parameters: AddPieceFromLink,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: (input) => links.addPieceFromLink(input).pipe(Effect.map(show)),
  }),
]

/** The wardrobe's tools: thin projections of the same `Wardrobe` operations the website uses. */
export const wardrobeTools = (wardrobe: Wardrobe['Service'], links: Links['Service'], origin: string) => {
  const show = shown(origin)
  return [
    ...readTools(wardrobe, show),
    ...writeTools(wardrobe, links, show, origin),
    ...linkTools(wardrobe, links, show),
  ]
}
