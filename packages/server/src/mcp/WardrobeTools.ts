import {
  AddPiece,
  Category,
  Colour,
  CreateUpload,
  ImageType,
  type LinkRefused,
  OperationId,
  type OperationConflict,
  type Piece,
  PieceId,
  type PieceNotFound,
  type SubcategoryMismatch,
  UpdatePiece,
  UploadId,
  type UploadRefused,
  type WardrobeUnavailable,
  maximumImageBytes,
  subcategories,
} from '@styld/protocol'
import { Effect, Match, Option, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { importedUpload, type ImportRefused } from './ImageImport.ts'
import { tool, ToolError } from './Tools.ts'
import { readProductPage } from '../links/LinkImport.ts'

type WardrobeFailure =
  | PieceNotFound
  | SubcategoryMismatch
  | OperationConflict
  | UploadRefused
  | WardrobeUnavailable
  | ImportRefused

const uploadRecovery: Readonly<Record<string, { message: string; recovery: string }>> = {
  notFound: {
    message: 'That upload does not exist or belongs to someone else.',
    recovery: 'Call upload_create for a new upload.',
  },
  expired: {
    message: 'That upload expired before the photo arrived.',
    recovery: 'Call upload_create again and PUT the photo within 15 minutes.',
  },
  notReceived: {
    message: 'The photo for that upload has not arrived yet.',
    recovery: 'PUT the photo bytes to the upload URL, then call piece_add again.',
  },
  alreadyUsed: {
    message: 'That upload already became a piece.',
    recovery: 'Call piece_search to find it, or upload a new photo.',
  },
  tooLarge: { message: 'The photo is larger than 15 MB.', recovery: 'Use a smaller photo.' },
  tooLong: { message: 'The video is longer than a minute.', recovery: 'Use a clip of a minute or less.' },
  notAnImage: {
    message: 'The file is not a JPEG, PNG, WebP, AVIF or GIF image.',
    recovery: 'Use a photo in one of those formats.',
  },
  wrongType: {
    message: 'The photo is not the type the upload declared.',
    recovery: 'Create the upload with the photo’s real content type.',
  },
  notHttps: {
    message: 'The photo address must be a plain https URL on the default port.',
    recovery: 'Give an https:// address of the image itself.',
  },
  tooManyRedirects: {
    message: 'The photo address redirected more than three times.',
    recovery: 'Give the final address of the image.',
  },
  notReached: {
    message: 'Styld could not download the photo from that address.',
    recovery: 'Check the address is public, or upload the photo with upload_create.',
  },
}

const photoRefused = ({ reason }: { readonly reason: string }) => {
  const known = uploadRecovery[reason] ?? { message: 'The photo was refused.', recovery: 'Try another photo.' }
  return new ToolError({ code: 'photo_refused', message: known.message, recovery: known.recovery, retryable: false })
}

/** Every wardrobe refusal as a tool error the assistant can act on. */
const asToolError = (error: WardrobeFailure): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      PieceNotFound: () =>
        new ToolError({
          code: 'not_found',
          message: 'There is no piece with that id in this wardrobe.',
          recovery: 'Call piece_search to find the piece.',
          retryable: false,
        }),
      SubcategoryMismatch: () =>
        new ToolError({
          code: 'invalid_subcategory',
          message: 'That subcategory belongs to another category.',
          recovery: `Use a subcategory of the category: ${JSON.stringify(subcategories)}.`,
          retryable: false,
        }),
      OperationConflict: () =>
        new ToolError({
          code: 'operation_conflict',
          message: 'That operationId was already used for a different change.',
          recovery: 'Use a new operationId for a new change.',
          retryable: false,
        }),
      UploadRefused: photoRefused,
      ImportRefused: photoRefused,
      WardrobeUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'Styld could not reach the wardrobe just now.',
          recovery: 'Try again in a moment.',
          retryable: true,
        }),
    }),
  )

/** A piece as assistants see it: its fields and its page on the website, never an image address. */
const shown = (origin: string) => (piece: Piece) => ({ ...piece, url: `${origin}/wardrobe/${piece.id}` })

const matches = (
  piece: Piece,
  input: { readonly query?: string; readonly category?: Category; readonly colour?: Colour },
) => {
  const query = input.query?.trim().toLowerCase() ?? ''
  const text = [piece.name, piece.notes, piece.category, piece.subcategory]
    .filter((part) => part !== null)
    .join(' ')
    .toLowerCase()
  return (
    (input.category === undefined || piece.category === input.category) &&
    (input.colour === undefined || piece.colours.includes(input.colour)) &&
    (query.length === 0 || text.includes(query))
  )
}

/** The piece's fields as the protocol defines them, so the website and assistants accept the same. */
const { category, subcategory, colours, name } = AddPiece.fields
const PieceFields = { category, subcategory, colours, name }

const LinkImport = Schema.Struct({
  operationId: OperationId,
  url: Schema.String.check(Schema.isMaxLength(2048)),
  ...PieceFields,
})

const linkRefusals: Readonly<Record<LinkRefused['reason'], ToolError>> = {
  notHttps: new ToolError({
    code: 'not_https',
    message: 'Only public https pages can be read.',
    recovery: 'Give the product page’s https address.',
    retryable: false,
  }),
  notReached: new ToolError({
    code: 'not_reached',
    message: 'Styld could not reach that page.',
    recovery: 'Check the address, or ask the person for a photo or screenshot and use piece_add.',
    retryable: true,
  }),
  blocked: new ToolError({
    code: 'blocked',
    message: 'The shop does not let Styld read that page.',
    recovery: 'Ask the person for a photo or screenshot of the piece and use piece_add or upload_create.',
    retryable: false,
  }),
  notAPage: new ToolError({
    code: 'not_a_page',
    message: 'That address is not a web page.',
    recovery: 'For a picture, use piece_add with imageUrl.',
    retryable: false,
  }),
  noPicture: new ToolError({
    code: 'no_picture',
    message: 'That page names no picture of a product.',
    recovery: 'Ask the person for a photo or screenshot and use piece_add or upload_create.',
    retryable: false,
  }),
}

const PieceAdd = Schema.Struct({
  operationId: OperationId,
  imageUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2048))),
  uploadId: Schema.optionalKey(UploadId),
  ...PieceFields,
})

const readTools = (wardrobe: Wardrobe['Service'], show: ReturnType<typeof shown>) => [
  tool({
    name: 'piece_search',
    title: 'Search the wardrobe',
    description:
      'Pieces in the wardrobe, newest first, filtered by words in their name or notes, a category or a colour. Returns up to `limit` pieces and a `nextCursor` for the next page (null on the last page).',
    parameters: Schema.Struct({
      query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(80))),
      category: Schema.optionalKey(Category),
      colour: Schema.optionalKey(Colour),
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
        Effect.mapError(asToolError),
      ),
  }),
  tool({
    name: 'piece_get',
    title: 'One piece',
    description: 'One piece of the wardrobe by its id, with its link on the website.',
    parameters: Schema.Struct({ pieceId: PieceId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: ({ pieceId }) => wardrobe.getPiece(pieceId).pipe(Effect.map(show), Effect.mapError(asToolError)),
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
      wardrobe.createUpload(input).pipe(
        Effect.map(({ uploadId, path, expiresAt }) => ({ uploadId, uploadUrl: `${origin}${path}`, expiresAt })),
        Effect.mapError(asToolError),
      ),
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
        const earlier = yield* wardrobe.pieceAddedBy(input.operationId).pipe(Effect.mapError(asToolError))
        if (Option.isSome(earlier)) return show(earlier.value)
        const target = uploadId ?? (yield* uploadFrom(wardrobe, http, imageUrl ?? ''))
        return show(yield* wardrobe.addPiece({ ...fields, uploadId: target }).pipe(Effect.mapError(asToolError)))
      }),
  }),
  tool({
    name: 'piece_update',
    title: 'Change a piece',
    description:
      'Change the name, notes, category, subcategory or colours of a piece. Fields left out stay as they are; null clears a name, notes or subcategory.',
    parameters: Schema.Struct({ pieceId: PieceId, ...UpdatePiece.fields }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: ({ pieceId, ...changes }) =>
      wardrobe.updatePiece(pieceId, changes).pipe(Effect.map(show), Effect.mapError(asToolError)),
  }),
  tool({
    name: 'piece_delete',
    title: 'Delete a piece',
    description: 'Delete a piece and its photo from the wardrobe for good. Ask the person before deleting.',
    parameters: Schema.Struct({ pieceId: PieceId }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: ({ pieceId }) =>
      wardrobe.deletePiece(pieceId).pipe(Effect.as({ deleted: true, pieceId }), Effect.mapError(asToolError)),
  }),
]

/** Adding a piece from a shop's product page. */
const linkTools = (wardrobe: Wardrobe['Service'], show: ReturnType<typeof shown>, http: HttpClient.HttpClient) => [
  tool({
    name: 'link_import',
    title: 'Add a piece from a link',
    description:
      'Add a piece from a shop’s product page: Styld reads the page’s picture and name and adds it straight to the wardrobe. Give the category; the name defaults to the page’s. Choose a new `operationId` for each piece. A shop that blocks reading answers `blocked`: then ask for a photo instead.',
    parameters: LinkImport,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: ({ url, name: chosen, ...fields }) =>
      Effect.gen(function* () {
        const earlier = yield* wardrobe.pieceAddedBy(fields.operationId).pipe(Effect.mapError(asToolError))
        if (Option.isSome(earlier)) return show(earlier.value)
        const page = yield* readProductPage(url).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.mapError(({ reason }) => linkRefusals[reason]),
        )
        const uploadId = yield* uploadFrom(wardrobe, http, page.image)
        const named = chosen ?? Option.getOrUndefined(page.title)
        return show(
          yield* wardrobe
            .addPiece({ ...fields, uploadId, ...(named === undefined ? {} : { name: named }) })
            .pipe(Effect.mapError(asToolError)),
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
  importedUpload(wardrobe, imageUrl).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.mapError(asToolError),
  )
