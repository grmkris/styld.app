import {
  AddPiece,
  Colour,
  GarmentGroup,
  groupOf,
  Occasion,
  Pattern,
  CreateUpload,
  ImageType,
  OperationId,
  type Piece,
  PieceId,
  PieceType,
  Season,
  UpdatePiece,
  UploadId,
  maximumImageBytes,
  textLength,
  Url,
  normalise,
  wordMatches,
  wordsIn,
} from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { importedUpload } from './ImageImport.ts'
import { paced } from './Pacing.ts'
import { tool, ToolError } from './Tools.ts'
import { readLink } from '../links/LinkPicture.ts'

/** A piece as assistants see it: its fields and its page on the website, never an image address. */
const shown = (origin: string) => (piece: Piece) => ({ ...piece, url: `${origin}/wardrobe/${piece.id}` })

/** What piece_search filters by: words, and any of the piece's type, group and attributes. */
const SearchFilter = Schema.Struct({
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(textLength.search))),
  type: Schema.optionalKey(PieceType),
  group: Schema.optionalKey(GarmentGroup),
  colour: Schema.optionalKey(Colour),
  season: Schema.optionalKey(Season),
  occasion: Schema.optionalKey(Occasion),
  pattern: Schema.optionalKey(Pattern),
  brand: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(textLength.brand))),
})

/** Words match as they do on the device (protocol `Search.ts`): any case or accent, any ending, a word's start. */
const matches = (piece: Piece, input: typeof SearchFilter.Type) => {
  const words = wordsIn([piece.name, piece.notes, piece.type, piece.brand].filter((part) => part !== null).join(' '))
  const typed = wordsIn(input.q ?? '')
  return (
    (input.type === undefined || piece.type === input.type) &&
    (input.group === undefined || groupOf(piece.type) === input.group) &&
    (input.colour === undefined || piece.colours.includes(input.colour)) &&
    (input.season === undefined || piece.season === input.season || piece.season === 'allYear') &&
    (input.occasion === undefined || piece.occasions.includes(input.occasion)) &&
    (input.pattern === undefined || piece.pattern === input.pattern) &&
    (input.brand === undefined || normalise(piece.brand ?? '') === normalise(input.brand)) &&
    typed.every((word) => words.some((each) => wordMatches(word, each)))
  )
}

/** The piece's fields as the protocol defines them, so the website and assistants accept the same. */
const { operationId: _operationId, uploadId: _uploadId, ...PieceFields } = AddPiece.fields

const LinkImport = Schema.Struct({
  operationId: OperationId,
  url: Url,
  ...PieceFields,
})

const PieceAdd = Schema.Struct({
  operationId: OperationId,
  imageUrl: Schema.optionalKey(Url),
  uploadId: Schema.optionalKey(UploadId),
  ...PieceFields,
})

const readTools = (wardrobe: Wardrobe['Service'], show: ReturnType<typeof shown>) => [
  tool({
    name: 'piece_search',
    title: 'Search the wardrobe',
    description:
      'Pieces in the wardrobe, newest first, filtered by words (`q`) in their name, notes or brand, and by garment type, group, colour, season, occasion, pattern or brand. Returns up to `limit` pieces and a `nextCursor` for the next page (null on the last page).',
    parameters: Schema.Struct({
      ...SearchFilter.fields,
      limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
      cursor: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9]{1,6}$/))),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input) =>
      wardrobe.listPieces().pipe(
        Effect.map((pieces) => {
          const found = pieces.filter((piece) => matches(piece, input))
          const start = Number(input.cursor ?? '0')
          const end = start + (input.limit ?? 20)
          return { pieces: found.slice(start, end).map(show), nextCursor: end < found.length ? String(end) : null }
        }),
      ),
  }),
  tool({
    name: 'piece_get',
    title: 'One piece',
    description: 'One piece of the wardrobe by its id, with its link on the website.',
    parameters: Schema.Struct({ pieceId: PieceId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: ({ pieceId }) => wardrobe.getPiece(pieceId).pipe(Effect.map(show)),
  }),
]

const writeTools = (
  wardrobe: Wardrobe['Service'],
  show: ReturnType<typeof shown>,
  origin: string,
  http: HttpClient.HttpClient,
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
      'Add a piece of clothing from a photo: either `imageUrl` (a public https address of the image) or an `uploadId` from upload_create. Choose a new `operationId` for each piece; repeating a call with the same one returns the first result instead of adding twice. The piece is `processing` for a few seconds, then `ready`.',
    parameters: PieceAdd,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: (input) =>
      Effect.gen(function* () {
        const { imageUrl, uploadId, ...fields } = input
        if ((imageUrl === undefined) === (uploadId === undefined))
          return yield* new ToolError({
            code: 'invalid_arguments',
            message: 'Give exactly one of imageUrl or uploadId.',
            recovery: 'Pass imageUrl for a photo on the web, or uploadId after upload_create.',
            retryable: false,
          })
        const earlier = yield* wardrobe.pieceAddedBy(input.operationId)
        if (Option.isSome(earlier)) return show(earlier.value)
        const target = uploadId ?? (yield* uploadFrom(wardrobe, http, imageUrl ?? ''))
        return show(yield* wardrobe.addPiece({ ...fields, uploadId: target }))
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
    description: 'Delete a piece and its photo from the wardrobe for good. Ask the person before deleting.',
    parameters: Schema.Struct({ pieceId: PieceId }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: ({ pieceId }) => wardrobe.deletePiece(pieceId).pipe(Effect.as({ deleted: true, pieceId })),
  }),
]

/** Adding a piece from a shop's product page. */
const linkTools = (wardrobe: Wardrobe['Service'], show: ReturnType<typeof shown>, http: HttpClient.HttpClient) => [
  tool({
    name: 'link_import',
    title: 'Add a piece from a link',
    description:
      'Add a piece from a shop’s product page: Styld reads the page’s picture and name and adds it straight to the wardrobe. Give the garment type; the name defaults to the page’s. Choose a new `operationId` for each piece. A shop that blocks reading answers `blocked`: then ask for a photo instead.',
    parameters: LinkImport,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: ({ url, name: chosen, ...fields }) =>
      Effect.gen(function* () {
        const earlier = yield* wardrobe.pieceAddedBy(fields.operationId)
        if (Option.isSome(earlier)) return show(earlier.value)
        // The same links operation the website calls, under its own id derived from the piece's.
        const read = { operationId: OperationId.make(`${fields.operationId.slice(0, 59)}-link`), url }
        const picture = yield* paced('link')(
          readLink(wardrobe, read).pipe(Effect.provideService(HttpClient.HttpClient, http)),
        )
        const named = chosen ?? picture.name
        return show(
          yield* wardrobe.addPiece({
            ...fields,
            uploadId: picture.uploadId,
            ...(named === null ? {} : { name: named }),
          }),
        )
      }),
  }),
]

/** The wardrobe's tools: thin projections of the same `Wardrobe` operations the website uses. */
export const wardrobeTools = (wardrobe: Wardrobe['Service'], origin: string, http: HttpClient.HttpClient) => {
  const show = shown(origin)
  return [...readTools(wardrobe, show), ...writeTools(wardrobe, show, origin, http), ...linkTools(wardrobe, show, http)]
}

/** Download the photo an assistant points at into a fresh upload. */
export const uploadFrom = (wardrobe: Wardrobe['Service'], http: HttpClient.HttpClient, imageUrl: string) =>
  paced('link')(fetchedUpload(wardrobe, http, imageUrl))

/** The photo at an address as a fresh upload, without counting against the account's pace. */
const fetchedUpload = (wardrobe: Wardrobe['Service'], http: HttpClient.HttpClient, imageUrl: string) =>
  importedUpload(wardrobe, imageUrl).pipe(Effect.provideService(HttpClient.HttpClient, http))
