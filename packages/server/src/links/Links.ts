import {
  type AddPieceFromLink,
  type AddPieceFromPhoto,
  type BoardId,
  LinkPicture,
  OperationId,
  type PinPicture,
  type ReadLink,
  Unavailable,
  UploadId,
} from '@styld/protocol'
import { Context, Effect, Layer, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { digestOf } from '../kernel/Ids.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { importedUpload } from './ImageImport.ts'
import { publicClient } from '../providers/PublicWeb.ts'
import { Boards } from '../boards/Boards.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { pictureFromLink } from './LinkPicture.ts'

const LinkPictureJson = Schema.fromJsonString(LinkPicture)

/** What Styld fetches from the web for the person, at the account's `link` pace: a shop's product page and a photo's
 * address, each read into a received upload, and what is made of them in one operation (a piece, a board's picture).
 * The website, the assistants and Styld's tools share it. */
const make = Effect.gen(function* () {
  const wardrobe = yield* Wardrobe
  const boards = yield* Boards
  const pacing = yield* Pacing
  const http = yield* publicClient
  const fetched = <A, E, R>(work: Effect.Effect<A, E, R | HttpClient.HttpClient>) =>
    Effect.andThen(pacing.account('link'), work.pipe(Effect.provideService(HttpClient.HttpClient, http)))
  const reading = {
    /** A shop's page read into an upload, answered once per operation id: a repeat neither reads the page again,
     * nor makes a second upload, nor counts against the pace. */
    readLink: Effect.fn('Styld.Links.readLink')(function* (input: ReadLink) {
      return yield* wardrobe.once(
        { operationId: input.operationId, command: 'readLink', input: input.url },
        {
          replay: (result) =>
            Schema.decodeUnknownEffect(LinkPictureJson)(result).pipe(Effect.mapError(() => Unavailable.make({}))),
          run: Effect.flatMap(fetched(pictureFromLink(wardrobe, input.url)), (picture) =>
            Effect.map(
              Schema.encodeEffect(LinkPictureJson)(picture).pipe(Effect.mapError(() => Unavailable.make({}))),
              (result) => [picture, result] as const,
            ),
          ),
        },
      )
    }),
    /** The photo at an address as a fresh received upload of the person's, answered once per operation id: a repeat
     * neither fetches it again nor makes a second upload. */
    photoFrom: Effect.fn('Styld.Links.photoFrom')(function* (input: ReadLink) {
      return yield* wardrobe.once(
        { operationId: input.operationId, command: 'importPhoto', input: input.url },
        {
          replay: (result) =>
            Schema.decodeUnknownEffect(UploadId)(result).pipe(Effect.mapError(() => Unavailable.make({}))),
          run: Effect.map(fetched(importedUpload(wardrobe, input.url)), (uploadId) => [uploadId, uploadId] as const),
        },
      )
    }),
  }
  return {
    ...reading,
    /** A piece from a shop's product page: the page read under its own operation, derived from the piece's, then the
     * piece added under the piece's; a repeat answers from both receipts. The name defaults to the page's. */
    addPieceFromLink: Effect.fn('Styld.Links.addPieceFromLink')(function* (input: AddPieceFromLink) {
      const { url, name: chosen, ...fields } = input
      const picture = yield* reading.readLink({
        operationId: yield* fetchOperation(fields.operationId, 'link_import'),
        url,
      })
      const named = chosen ?? picture.name
      return yield* wardrobe.addPiece({
        ...fields,
        uploadId: picture.uploadId,
        ...(named === null ? {} : { name: named }),
      })
    }),
    /** A piece from a photo at a public address: fetched under its own operation, derived from the piece's, then
     * added under the piece's; a repeat answers from both receipts. */
    addPieceFromPhoto: Effect.fn('Styld.Links.addPieceFromPhoto')(function* (input: AddPieceFromPhoto) {
      const { imageUrl, ...fields } = input
      const uploadId = yield* reading.photoFrom({
        operationId: yield* fetchOperation(fields.operationId, 'piece_add'),
        url: imageUrl,
      })
      return yield* wardrobe.addPiece({ ...fields, uploadId })
    }),
    /** A picture at a public address pinned on the board: fetched under its own operation, derived from the pin's,
     * then pinned under the pin's; a repeat answers from both receipts. */
    pinPicture: Effect.fn('Styld.Links.pinPicture')(function* (boardId: BoardId, input: PinPicture) {
      const uploadId = yield* reading.photoFrom({
        operationId: yield* fetchOperation(input.operationId, 'picture_pin'),
        url: input.imageUrl,
      })
      return yield* boards.addBoardImage(boardId, { operationId: input.operationId, uploadId })
    }),
  }
})

/** The write whose fetch from the web this is, which scopes the fetch's own operation. Named after the assistants'
 * tools that first made them, so the receipts of fetches made before keep answering. */
type FetchingWrite = 'piece_add' | 'link_import' | 'picture_pin'

/** The operation a write's fetch runs under, derived from the write's whole id and the write: a piece added from a
 * photo or a shop's page, or a picture pinned from the web, fetches once, and its repeat answers from both receipts. A
 * digest, so two ids that differ anywhere name two fetches (a 64-character id cut short would not). */
export const fetchOperation = (operationId: OperationId, tool: FetchingWrite) =>
  Effect.map(digestOf(JSON.stringify([tool, operationId])), (digest) => OperationId.make(`link-${digest}`))

export class Links extends Context.Service<Links, Effect.Success<typeof make>>()('@styld/server/links/Links') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Links.of(service)),
  )
}
