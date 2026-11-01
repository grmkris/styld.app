import {
  type AddPiece,
  type CreateUpload,
  type CreateVideoUpload,
  CurrentAccount,
  NoCleanPicture,
  NotFound,
  type PictureChoice,
  Piece,
  type PieceId,
  type UpdatePiece,
  Upload,
  UploadId,
  UploadRefused,
} from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Option, Predicate } from 'effect'
import { type ByteStream, pump } from '../Streams.ts'
import { deliverImage } from './Delivery.ts'
import { type ImageSize, isVideoContainer, piecePrefix, sniffImageType, uploadKey } from './Media.ts'
import { backing } from './Back.ts'
import { GarmentCutout, PieceQueue } from './Processing.ts'
import { processing } from './Work.ts'
import { Holds } from '../usage/Holds.ts'
import {
  ownerPiece,
  forgetObjects,
  ownPiece,
  type Parts,
  pictureRow,
  refused,
  stored,
  toPiece,
  unavailable,
  usableUpload,
  type WardrobeBindings,
} from './Parts.ts'
import { Database, nowDate } from '../kernel/Db.ts'
import { pictureView, shownImage, shows, turnView } from './Shown.ts'
import { makeStore, type PictureRow, type PieceRow, type UploadRow } from './Store.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { digestOf, randomToken } from '../kernel/Ids.ts'
import { once, type Operation } from '../kernel/Receipts.ts'
import { identify, priorResult, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { keysUnder, Media } from '../kernel/Media.ts'

/** A video's request body, as the Worker runtime streams it. */
export type VideoBody =
  Parameters<FixedLengthStream['writable']['getWriter']> extends [] ? Request['body'] & object : never

/** An upload path stays valid this long after it is handed out. */
const uploadLifetime = { minutes: 15 }

/** Why an upload cannot take these bytes, if it cannot. The bytes' own signature decides their
 * type, not the request's header. */
const receiveRefusal = (
  upload: UploadRow,
  input: { readonly contentType: string; readonly body: Uint8Array },
  nowMillis: number,
): Option.Option<UploadRefused['reason']> => {
  if (upload.status !== 'pending') return Option.some('alreadyUsed')
  if (upload.expiresAt.getTime() <= nowMillis) return Option.some('expired')
  if (input.contentType !== upload.contentType) return Option.some('wrongType')
  if (input.body.byteLength === 0 || input.body.byteLength > upload.bytes) return Option.some('tooLarge')
  if (!Option.contains(sniffImageType(input.body), upload.contentType)) return Option.some('notAnImage')
  return Option.none()
}

/** Why a video upload cannot take this stream, if it cannot. The stored bytes' signature is checked
 * after they land, since the stream is not read whole. */
const videoRefusal = (
  upload: UploadRow,
  input: { readonly contentType: string; readonly bytes: number },
  nowMillis: number,
): Option.Option<UploadRefused['reason']> => {
  if (upload.status !== 'pending') return Option.some('alreadyUsed')
  if (upload.expiresAt.getTime() <= nowMillis) return Option.some('expired')
  if (input.contentType !== upload.contentType || !upload.contentType.startsWith('video/'))
    return Option.some('wrongType')
  if (input.bytes !== upload.bytes) return Option.some('tooLarge')
  return Option.none()
}

const enqueue = (parts: Parts, pieceId: string) =>
  Effect.tryPromise({ try: () => parts.bindings.queue.send({ _tag: 'ProcessPiece', pieceId }), catch: unavailable })

const reads = (parts: Parts) => ({
  listPieces: Effect.fn('Styld.Wardrobe.listPieces')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored(parts.store.listPieces(accountId))
    const pictures = new Map((yield* stored(parts.store.picturesOf(accountId))).map((row) => [row.pieceId, row]))
    const turns = new Map((yield* stored(parts.store.turnsOf(accountId))).map((row) => [row.pieceId, row]))
    const at = yield* nowDate
    return yield* Effect.forEach(rows, (row) => {
      const picture = pictures.get(row.id)
      const turn = turns.get(row.id)
      return toPiece(
        row,
        picture === undefined ? undefined : pictureView(picture, at),
        turn === undefined ? undefined : turnView(turn, at),
      )
    })
  }),
  getPiece: Effect.fn('Styld.Wardrobe.getPiece')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    return yield* ownerPiece(parts, accountId, yield* ownPiece(parts)(pieceId))
  }),
})

/** The upload a path's token unlocks. A wrong token, and an account closed for deletion, both read as
 * not found. */
const tokenUpload = (parts: Parts, uploadId: string, token: string) =>
  Effect.gen(function* () {
    const row = yield* stored(parts.store.findUpload(uploadId))
    if (Option.isNone(row) || (yield* digestOf(token)) !== row.value.tokenDigest) return yield* refused('notFound')
    if (!(yield* stored(parts.store.accountEnabled(row.value.accountId)))) return yield* refused('notFound')
    return row.value
  })

/** The upload path for a token. */
const uploadPath = (uploadId: string, token: string) => `/api/uploads/${uploadId}?token=${token}`

/** The upload an operation made, answered again with a fresh token: the first answer, and its token, were lost. */
const reissued = (parts: Parts, accountId: string, uploadId: string) =>
  Effect.gen(function* () {
    const row = yield* stored(parts.store.findUpload(uploadId))
    if (Option.isNone(row) || row.value.accountId !== accountId) return yield* refused('notFound')
    const token = yield* randomToken(32)
    yield* stored(parts.store.reissueUpload(uploadId, yield* digestOf(token)))
    const upload: typeof Upload.Type = {
      uploadId: UploadId.make(uploadId),
      path: uploadPath(uploadId, token),
      expiresAt: row.value.expiresAt.toISOString(),
    }
    return upload
  })

/** A one-time upload path for a file of this type and size; its token is stored only as a digest. */
const newUpload = (parts: Parts) =>
  Effect.fn('Styld.Wardrobe.newUpload')(function* (input: {
    readonly contentType: UploadRow['contentType']
    readonly bytes: number
  }) {
    const { accountId } = yield* CurrentAccount
    const uploadId = `up_${yield* randomToken(16)}`
    const token = yield* randomToken(32)
    const expiresAt = DateTime.toDateUtc(DateTime.add(yield* DateTime.now, uploadLifetime))
    yield* stored(
      parts.store.insertUpload({
        id: uploadId,
        accountId,
        tokenDigest: yield* digestOf(token),
        contentType: input.contentType,
        bytes: input.bytes,
        objectKey: uploadKey(accountId, uploadId),
        status: 'pending',
        expiresAt,
      }),
    )
    const upload: typeof Upload.Type = {
      uploadId: UploadId.make(uploadId),
      path: uploadPath(uploadId, token),
      expiresAt: expiresAt.toISOString(),
    }
    return upload
  })

const uploads = (parts: Parts) => ({
  /** An upload Styld makes itself, for picture bytes it holds: an import, a photo pinned on a board. */
  newUpload: newUpload(parts),
  /** Hand out a one-time upload path; repeating the operation answers the same upload with a fresh token. */
  createUpload: Effect.fn('Styld.Wardrobe.createUpload')(function* (
    input: typeof CreateUpload.Type | typeof CreateVideoUpload.Type,
  ) {
    const { accountId } = yield* CurrentAccount
    const { operationId, ...file } = input
    return yield* once(
      parts.store,
      { accountId, operationId, command: 'createUpload', input: file },
      {
        replay: (uploadId) => reissued(parts, accountId, uploadId),
        run: Effect.map(newUpload(parts)(file), (upload) => [upload, upload.uploadId] as const),
      },
    )
  }),
  /** Store a photo's bytes against its upload. The token is the only credential. */
  receiveUpload: Effect.fn('Styld.Wardrobe.receiveUpload')(function* (input: {
    readonly uploadId: string
    readonly token: string
    readonly contentType: string
    readonly body: Uint8Array
  }) {
    const upload = yield* tokenUpload(parts, input.uploadId, input.token)
    const refusal = receiveRefusal(upload, input, DateTime.toEpochMillis(yield* DateTime.now))
    if (Option.isSome(refusal)) return yield* refused(refusal.value)
    yield* Effect.tryPromise({
      try: () =>
        parts.bindings.bucket.put(upload.objectKey, input.body, { httpMetadata: { contentType: upload.contentType } }),
      catch: unavailable,
    })
    yield* stored(parts.store.markUploadReceived(upload.id))
  }),
})

/** Stream a body of a known length into the bucket. A FixedLengthStream tells R2 the length up front,
 * and fails if the body is any other length. */
const streamInto = (parts: Parts, key: string, contentType: string, bytes: number, body: ByteStream) =>
  Effect.tryPromise({
    try: async () => {
      const { readable, writable } = new FixedLengthStream(bytes)
      const writer = writable.getWriter()
      await Promise.all([
        // SAFETY: FixedLengthStream's readable is the Worker runtime's stream R2 takes -- the global ReadableStream name resolves to the DOM lib's here
        parts.bindings.bucket.put(key, readable as never, { httpMetadata: { contentType } }),
        pump(body, { write: (chunk) => writer.write(chunk), close: () => writer.close() }),
      ])
    },
    catch: unavailable,
  })

/** The first bytes of a stored object, enough for a container signature. */
const storedHead = (parts: Parts, key: string) =>
  Effect.tryPromise({
    try: async () => {
      const object = await parts.bindings.bucket.get(key, { range: { offset: 0, length: 12 } })
      return object === null ? new Uint8Array() : new Uint8Array(await object.arrayBuffer())
    },
    catch: unavailable,
  })

const videoUploads = (parts: Parts) => ({
  /** Store a video's bytes against its upload, streamed into the bucket rather than read whole. The
   * stream must be exactly the declared length, and the stored bytes must be an MP4 or MOV file. */
  receiveVideoUpload: Effect.fn('Styld.Wardrobe.receiveVideoUpload')(function* (input: {
    readonly uploadId: string
    readonly token: string
    readonly contentType: string
    readonly bytes: number
    readonly body: ByteStream
  }) {
    const upload = yield* tokenUpload(parts, input.uploadId, input.token)
    const refusal = videoRefusal(upload, input, DateTime.toEpochMillis(yield* DateTime.now))
    if (Option.isSome(refusal)) return yield* refused(refusal.value)
    yield* streamInto(parts, upload.objectKey, upload.contentType, input.bytes, input.body)
    if (!isVideoContainer(yield* storedHead(parts, upload.objectKey))) {
      yield* Effect.tryPromise({ try: () => parts.bindings.bucket.delete(upload.objectKey), catch: unavailable })
      return yield* refused('notAnImage')
    }
    yield* stored(parts.store.markUploadReceived(upload.id))
  }),
})

/** The answer to an operation id that was already used: the same piece, never a second one. */
const replay = (parts: Parts, accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    const row = yield* stored(parts.store.findPiece(accountId, pieceId))
    if (Option.isNone(row)) return yield* refused('alreadyUsed')
    // A replay after a lost queue message schedules the processing again; processing is idempotent.
    if (row.value.status === 'processing') yield* enqueue(parts, row.value.id).pipe(Effect.ignore)
    return yield* toPiece(row.value)
  })

/** A batch the store refused. If the same operation committed after all (a lost answer or a
 * concurrent repeat), its receipt answers; otherwise another operation used the upload, or D1
 * failed. */
const addFailure = (parts: Parts, operation: Identified, uploadId: string) =>
  Effect.gen(function* () {
    const prior = yield* priorResult(
      operation,
      yield* stored(parts.store.findReceipt(operation.accountId, operation.operationId)),
    )
    if (Option.isSome(prior)) return yield* replay(parts, operation.accountId, prior.value)
    const latest = yield* stored(parts.store.findUpload(uploadId))
    return yield* Option.exists(latest, ({ status }) => status === 'used') ? refused('alreadyUsed') : unavailable()
  })

const newPiece = (
  input: AddPiece,
  upload: UploadRow,
  context: { readonly id: string; readonly via: 'session' | 'assistant'; readonly now: Date },
): PieceRow => ({
  id: context.id,
  accountId: upload.accountId,
  name: input.name ?? null,
  notes: null,
  type: input.type,
  colours: input.colours ?? [],
  season: input.season ?? null,
  occasions: input.occasions ?? [],
  pattern: input.pattern ?? null,
  brand: input.brand ?? null,
  shopUrl: input.shopUrl ?? null,
  // Whoever adds a piece names its type; only pieces carried over from the old categories wait for a suggestion.
  suggestedAt: context.now,
  detectionId: null,
  backImageKey: null,
  status: 'processing',
  source: context.via === 'assistant' ? 'assistant' : 'website',
  uploadId: upload.id,
  originalKey: upload.objectKey,
  imageKey: null,
  contentType: upload.contentType,
  bytes: upload.bytes,
  createdAt: context.now,
  updatedAt: context.now,
})

const adding = (parts: Parts) => ({
  addPiece: Effect.fn('Styld.Wardrobe.addPiece')(function* (input: AddPiece) {
    const { accountId, via } = yield* CurrentAccount
    const { operationId, ...meaning } = input
    const operation = yield* identify({ accountId, operationId, command: 'addPiece', input: meaning })
    const prior = yield* priorResult(operation, yield* stored(parts.store.findReceipt(accountId, operationId)))
    if (Option.isSome(prior)) return yield* replay(parts, accountId, prior.value)
    const upload = yield* usableUpload(parts.store, accountId, input.uploadId)
    const now = yield* nowDate
    const row = newPiece(input, upload, { id: `pc_${yield* randomToken(16)}`, via, now })
    const committed = yield* parts.store.addPiece(row, yield* receiptRow(operation, row.id)).pipe(
      Effect.as(Option.none<Piece>()),
      Effect.catchTag('StoreUnavailable', () =>
        addFailure(parts, operation, input.uploadId).pipe(Effect.map(Option.some)),
      ),
    )
    if (Option.isSome(committed)) return committed.value
    // The piece is stored; if its message is lost, the add answers retryable and the retry with
    // the same operation id replays it, which schedules the processing again.
    yield* enqueue(parts, row.id)
    return yield* toPiece(row)
  }),
})

const editing = (parts: Parts) => ({
  /** Show the clean drawing or the photo. Only a drawing that is ready or proposed can be chosen. */
  choosePicture: Effect.fn('Styld.Wardrobe.choosePicture')(function* (pieceId: PieceId, use: PictureChoice) {
    const { accountId } = yield* CurrentAccount
    const piece = yield* ownPiece(parts)(pieceId)
    const at = yield* nowDate
    const chosen = yield* stored(parts.store.choosePicture(accountId, pieceId, use, at))
    if (Option.isNone(chosen)) return yield* NoCleanPicture.make({})
    yield* parts.pieceChanged.changed(pieceId)
    return yield* ownerPiece(parts, accountId, piece)
  }),
  updatePiece: Effect.fn('Styld.Wardrobe.updatePiece')(function* (pieceId: PieceId, input: UpdatePiece) {
    const { accountId } = yield* CurrentAccount
    const current = yield* toPiece(yield* ownPiece(parts)(pieceId))
    // Setting fields is the same change however often it is sent, so the operation id needs no receipt.
    const { operationId: _operationId, ...changes } = input
    const updated = yield* stored(
      parts.store.updatePiece(accountId, pieceId, { ...changes, updatedAt: yield* nowDate }),
    )
    if (Option.isNone(updated)) return yield* NotFound.make({})
    // Its name is what others read of it: a public piece renamed is checked again before they see the new name.
    if (input.name !== undefined && input.name !== current.name) yield* parts.pieceChanged.changed(pieceId)
    return yield* ownerPiece(parts, accountId, updated.value)
  }),
  /** Delete a piece: its row, upload and check first, then its photo, cut-outs, back and drawings, except what another
   * piece or a tray card still shows (a reviewed piece shares its photo with the others found in it). */
  deletePiece: Effect.fn('Styld.Wardrobe.deletePiece')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    const piece = yield* ownPiece(parts)(pieceId)
    if (!(yield* stored(parts.store.deletePiece(accountId, piece)))) return yield* NotFound.make({})
    const own = yield* keysUnder(parts.bindings.bucket, piecePrefix(accountId, pieceId)).pipe(
      Effect.orElseSucceed(() => []),
    )
    const shown = [piece.originalKey, piece.imageKey, piece.backImageKey].filter(Predicate.isNotNull)
    yield* forgetObjects(parts, accountId, [...shown, ...own], 'piece')
  }),
})

/** The stored image behind one of a piece's pictures: the one it shows, its photo, its clean drawing or its back. */
const pictureImage = (
  piece: PieceRow,
  picture: PictureRow | undefined,
  which: 'shown' | 'photo' | 'clean' | 'back',
) => {
  if (which === 'shown') return Option.some(shownImage(piece, picture))
  if (which === 'photo') return Option.some(shownImage(piece, undefined))
  // The stored object's own type is what is served (`deliverImage`).
  if (which === 'back')
    return Option.map(Option.fromNullishOr(piece.backImageKey), (key) => ({ key, contentType: piece.contentType }))
  const drawn = picture?.cleanKey ?? null
  return drawn !== null && (picture?.state === 'ready' || picture?.state === 'proposed')
    ? Option.some({ key: drawn, contentType: 'image/png' })
    : Option.none()
}

const images = (parts: Parts) => ({
  /** One of the piece's pictures (the one it shows unless asked), resized to WebP by the Images binding. A photo
   * it cannot transform is served as it was stored. */
  pieceImage: Effect.fn('Styld.Wardrobe.pieceImage')(function* (
    pieceId: PieceId,
    size: ImageSize,
    which: 'shown' | 'photo' | 'clean' | 'back' = 'shown',
  ) {
    const { accountId } = yield* CurrentAccount
    const piece = yield* ownPiece(parts)(pieceId)
    const picture = yield* pictureRow(parts, accountId, pieceId)
    const source = pictureImage(piece, picture, which)
    if (Option.isNone(source)) return yield* NotFound.make({})
    const image = yield* deliverImage(parts.bindings, source.value, size)
    if (Option.isNone(image)) return yield* NotFound.make({})
    // A new drawing, or a change of which picture shows, is a new version of the shown image.
    const drawing =
      which === 'photo' || which === 'back'
        ? which
        : `${which === 'clean' ? 'clean' : shows(picture)}${picture?.version ?? 0}`
    return { ...image.value, version: `${piece.id}.${piece.updatedAt.getTime()}.${drawing}.${size}` }
  }),
})

const make = Effect.gen(function* () {
  const database = yield* Database
  const media = yield* Media
  const bindings: WardrobeBindings = {
    database: database.$client,
    bucket: media.bucket,
    images: media.images,
    queue: yield* PieceQueue,
  }
  const parts: Parts = {
    bindings,
    store: makeStore(bindings.database),
    cutout: yield* GarmentCutout,
    pieceChanged: yield* PieceChanged,
    holds: yield* Holds,
  }
  return {
    ...reads(parts),
    ...uploads(parts),
    ...videoUploads(parts),
    ...adding(parts),
    ...editing(parts),
    ...backing(parts),
    ...images(parts),
    ...processing(parts),
    /** An operation of the person's whose work is not one D1 batch, answered once per operation id from the
     * receipts (`kernel/Receipts.ts`): reading a shop's page into an upload. */
    once: <A, E, R, E2, R2>(
      operation: Omit<Operation, 'accountId'>,
      answer: Parameters<typeof once<A, E, R, E2, R2>>[2],
    ) => Effect.flatMap(CurrentAccount, ({ accountId }) => once(parts.store, { ...operation, accountId }, answer)),
  }
})

/** One implementation of every wardrobe operation. HTTP and MCP are projections of it; both provide
 * `CurrentAccount`, so an operation never takes whose wardrobe it is from its input. */
export class Wardrobe extends Context.Service<Wardrobe, Effect.Success<typeof make>>()(
  '@styld/server/wardrobe/Wardrobe',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Wardrobe.of(service)),
  )
}
