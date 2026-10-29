import {
  Category,
  Colour,
  Colours,
  CreateUpload,
  ImageType,
  OperationId,
  type OperationConflict,
  type Piece,
  PieceId,
  type PieceNotFound,
  Subcategory,
  type SubcategoryMismatch,
  UploadId,
  type UploadRefused,
  type WardrobeUnavailable,
  maximumImageBytes,
  subcategories,
} from '@styld/protocol'
import { Effect, Match, Option, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { importImage, type ImportRefused } from './ImageImport.ts'
import { tool, ToolError } from './Tools.ts'

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

const PieceFields = {
  category: Category,
  subcategory: Schema.optionalKey(Subcategory),
  colours: Schema.optionalKey(Colours),
  name: Schema.optionalKey(Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))),
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
        const target = uploadId ?? (yield* uploadFrom(wardrobe, http, origin, imageUrl ?? ''))
        return show(yield* wardrobe.addPiece({ ...fields, uploadId: target }).pipe(Effect.mapError(asToolError)))
      }),
  }),
  tool({
    name: 'piece_update',
    title: 'Change a piece',
    description:
      'Change the name, notes, category, subcategory or colours of a piece. Fields left out stay as they are; null clears a name, notes or subcategory.',
    parameters: Schema.Struct({
      pieceId: PieceId,
      name: Schema.optionalKey(
        Schema.NullOr(Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))),
      ),
      notes: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(500)))),
      category: Schema.optionalKey(Category),
      subcategory: Schema.optionalKey(Schema.NullOr(Subcategory)),
      colours: Schema.optionalKey(Colours),
    }),
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

/** The wardrobe's tools: thin projections of the same `Wardrobe` operations the website uses. */
export const wardrobeTools = (wardrobe: Wardrobe['Service'], origin: string, http: HttpClient.HttpClient) => {
  const show = shown(origin)
  return [...readTools(wardrobe, show), ...writeTools(wardrobe, show, origin, http)]
}

/** Download the photo an assistant points at into a fresh upload. */
const uploadFrom = (wardrobe: Wardrobe['Service'], http: HttpClient.HttpClient, origin: string, imageUrl: string) =>
  Effect.gen(function* () {
    const { contentType, bytes } = yield* importImage(imageUrl)
    // The photo goes through the same upload checks as one an assistant PUTs itself.
    const upload = yield* wardrobe.createUpload({ contentType, bytes: bytes.byteLength })
    const token = new URL(upload.path, origin).searchParams.get('token') ?? ''
    yield* wardrobe.receiveUpload({ uploadId: upload.uploadId, token, contentType, body: bytes })
    return upload.uploadId
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.mapError(asToolError))
