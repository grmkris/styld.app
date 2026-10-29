import type * as Cloudflare from '@alchemy.run/cloudflare'
import {
  type AddPiece,
  type CreateUpload,
  type CreateVideoUpload,
  OperationConflict,
  type OperationId,
  Piece,
  PieceNotFound,
  type PieceId,
  type Subcategory,
  SubcategoryMismatch,
  type UpdatePiece,
  Upload,
  UploadId,
  UploadRefused,
  WardrobeUnavailable,
  subcategoryFits,
} from '@styld/protocol'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Context, DateTime, Effect, Option, Predicate, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { type ByteStream, pump } from '../Streams.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { type ImageSize, imageSizes, isVideoContainer, sniffImageType, uploadKey } from './Media.ts'
import { GarmentCutout, type WorkMessage } from './Processing.ts'
import { makeStore, type PieceRow, type Store, type StoreUnavailable, type UploadRow } from './Store.ts'

type Runtime<Client extends { readonly raw: Effect.Effect<unknown> | Effect.Effect<unknown, never, RuntimeContext> }> =
  Effect.Success<Client['raw']>

/** The Cloudflare bindings the wardrobe stores into, as Alchemy's runtime objects. */
export interface WardrobeBindings {
  readonly database: Parameters<typeof makeStore>[0]
  readonly bucket: Runtime<Cloudflare.R2.ReadWriteBucketClient>
  readonly images: Runtime<Cloudflare.Images.ImagesClient>
  readonly queue: { send(message: WorkMessage): Promise<unknown> }
}

/** A video's request body, as the Worker runtime streams it. */
export type VideoBody =
  Parameters<FixedLengthStream['writable']['getWriter']> extends [] ? Request['body'] & object : never

/** An upload path stays valid this long after it is handed out. */
const uploadLifetime = { minutes: 15 }

const unavailable = () => WardrobeUnavailable.make({})
const refused = (reason: UploadRefused['reason']) => UploadRefused.make({ reason })
const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) => Effect.mapError(effect, unavailable)
const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** A stored piece as the protocol shows it. */
export const toPiece = (row: PieceRow) =>
  Schema.decodeUnknownEffect(Piece)({
    id: row.id,
    name: row.name,
    notes: row.notes,
    category: row.category,
    subcategory: row.subcategory,
    colours: row.colours,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
  }).pipe(Effect.orDie)

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

/** Why an upload cannot become a piece, if it cannot. */
const addRefusal = (upload: Option.Option<UploadRow>): Option.Option<UploadRefused['reason']> =>
  Option.match(upload, {
    onNone: () => Option.some('notFound'),
    onSome: ({ status }) =>
      status === 'pending'
        ? Option.some('notReceived')
        : status === 'used'
          ? Option.some('alreadyUsed')
          : Option.none(),
  })

/** The subcategory after a change: the one it names, else the current one if the (new) category
 * still has it. */
const nextSubcategory = (current: Piece, input: UpdatePiece): Subcategory | null => {
  if (input.subcategory !== undefined) return input.subcategory
  const category = input.category ?? current.category
  return current.subcategory !== null && subcategoryFits(category, current.subcategory) ? current.subcategory : null
}

interface Parts {
  readonly bindings: WardrobeBindings
  readonly store: Store
  readonly cutout: GarmentCutout['Service']
  readonly randomToken: (bytes: number) => Effect.Effect<string, WardrobeUnavailable>
  readonly digest: (text: string) => Effect.Effect<string, WardrobeUnavailable>
}

const ownPiece = (parts: Parts) =>
  Effect.fnUntraced(function* (pieceId: string) {
    const { accountId } = yield* CurrentAccount
    const row = yield* stored(parts.store.findPiece(accountId, pieceId))
    return yield* Option.match(row, { onNone: () => Effect.fail(PieceNotFound.make({})), onSome: Effect.succeed })
  })

const enqueue = (parts: Parts, pieceId: string) =>
  Effect.tryPromise({ try: () => parts.bindings.queue.send({ pieceId }), catch: unavailable })

const reads = (parts: Parts) => ({
  listPieces: Effect.fn('Styld.Wardrobe.listPieces')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored(parts.store.listPieces(accountId))
    return yield* Effect.forEach(rows, toPiece)
  }),
  getPiece: Effect.fn('Styld.Wardrobe.getPiece')(function* (pieceId: PieceId) {
    return yield* toPiece(yield* ownPiece(parts)(pieceId))
  }),
})

/** The upload a path's token unlocks. A wrong token, and an account closed for deletion, both read as
 * not found. */
const tokenUpload = (parts: Parts, uploadId: string, token: string) =>
  Effect.gen(function* () {
    const row = yield* stored(parts.store.findUpload(uploadId))
    if (Option.isNone(row) || (yield* parts.digest(token)) !== row.value.tokenDigest) return yield* refused('notFound')
    if (!(yield* stored(parts.store.accountEnabled(row.value.accountId)))) return yield* refused('notFound')
    return row.value
  })

const uploads = (parts: Parts) => ({
  /** Hand out a one-time upload path; its token is stored only as a digest. */
  createUpload: Effect.fn('Styld.Wardrobe.createUpload')(function* (
    input: typeof CreateUpload.Type | typeof CreateVideoUpload.Type,
  ) {
    const { accountId } = yield* CurrentAccount
    const uploadId = `up_${yield* parts.randomToken(16)}`
    const token = yield* parts.randomToken(32)
    const expiresAt = DateTime.toDateUtc(DateTime.add(yield* DateTime.now, uploadLifetime))
    yield* stored(
      parts.store.insertUpload({
        id: uploadId,
        accountId,
        tokenDigest: yield* parts.digest(token),
        contentType: input.contentType,
        bytes: input.bytes,
        objectKey: uploadKey(accountId, uploadId),
        status: 'pending',
        expiresAt,
      }),
    )
    const upload: typeof Upload.Type = {
      uploadId: UploadId.make(uploadId),
      path: `/api/uploads/${uploadId}?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    }
    return upload
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
const addFailure = (
  parts: Parts,
  input: {
    readonly accountId: string
    readonly operationId: string
    readonly uploadId: string
    readonly inputDigest: string
  },
) =>
  Effect.gen(function* () {
    const receipt = yield* stored(parts.store.findReceipt(input.accountId, input.operationId))
    if (Option.isSome(receipt) && receipt.value.inputDigest === input.inputDigest)
      return yield* replay(parts, input.accountId, receipt.value.result)
    const latest = yield* stored(parts.store.findUpload(input.uploadId))
    return yield* Option.exists(latest, ({ status }) => status === 'used') ? refused('alreadyUsed') : unavailable()
  })

/** What an add means apart from its operation id: a repeat of the same meaning replays it. */
const addMeaning = (input: AddPiece) =>
  JSON.stringify([input.uploadId, input.category, input.subcategory ?? null, input.colours ?? [], input.name ?? null])

const newPiece = (
  input: AddPiece,
  upload: UploadRow,
  context: { readonly id: string; readonly via: 'session' | 'assistant'; readonly now: Date },
): PieceRow => ({
  id: context.id,
  accountId: upload.accountId,
  name: input.name ?? null,
  notes: null,
  category: input.category,
  subcategory: input.subcategory ?? null,
  detectionId: null,
  backImageKey: null,
  colours: input.colours ?? [],
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
  /** The piece an operation id already added, if any: an assistant repeating an add from a photo
   * address gets it back without the photo being fetched again. */
  pieceAddedBy: Effect.fn('Styld.Wardrobe.pieceAddedBy')(function* (operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const receipt = yield* stored(parts.store.findReceipt(accountId, operationId))
    if (Option.isNone(receipt)) return Option.none<Piece>()
    return Option.some(yield* replay(parts, accountId, receipt.value.result))
  }),
  addPiece: Effect.fn('Styld.Wardrobe.addPiece')(function* (input: AddPiece) {
    const { accountId, via } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(addMeaning(input))
    const receipt = yield* stored(parts.store.findReceipt(accountId, input.operationId))
    if (Option.isSome(receipt))
      return receipt.value.inputDigest === inputDigest
        ? yield* replay(parts, accountId, receipt.value.result)
        : yield* OperationConflict.make({})
    if (input.subcategory !== undefined && !subcategoryFits(input.category, input.subcategory))
      return yield* SubcategoryMismatch.make({})
    const upload = Option.filter(
      yield* stored(parts.store.findUpload(input.uploadId)),
      (row) => row.accountId === accountId,
    )
    const refusal = addRefusal(upload)
    if (Option.isSome(refusal) || Option.isNone(upload))
      return yield* refused(Option.getOrElse(refusal, () => 'notFound'))
    const now = yield* nowDate
    const row = newPiece(input, upload.value, { id: `pc_${yield* parts.randomToken(16)}`, via, now })
    const receiptRow = {
      accountId,
      operationId: input.operationId,
      command: 'addPiece',
      inputDigest,
      result: row.id,
      createdAt: now,
    }
    const committed = yield* parts.store.addPiece(row, receiptRow).pipe(
      Effect.as(Option.none<Piece>()),
      Effect.catchTag('StoreUnavailable', () =>
        addFailure(parts, { accountId, operationId: input.operationId, uploadId: input.uploadId, inputDigest }).pipe(
          Effect.map(Option.some),
        ),
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
  updatePiece: Effect.fn('Styld.Wardrobe.updatePiece')(function* (pieceId: PieceId, input: UpdatePiece) {
    const { accountId } = yield* CurrentAccount
    const current = yield* toPiece(yield* ownPiece(parts)(pieceId))
    const category = input.category ?? current.category
    const subcategory = nextSubcategory(current, input)
    if (subcategory !== null && !subcategoryFits(category, subcategory)) return yield* SubcategoryMismatch.make({})
    const updated = yield* stored(
      parts.store.updatePiece(accountId, pieceId, {
        category,
        subcategory,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.colours === undefined ? {} : { colours: input.colours }),
        updatedAt: yield* nowDate,
      }),
    )
    return yield* Option.match(updated, { onNone: () => Effect.fail(PieceNotFound.make({})), onSome: toPiece })
  }),
  deletePiece: Effect.fn('Styld.Wardrobe.deletePiece')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    // Photos first: if the row's delete fails, a retry finds the piece and finishes.
    const piece = yield* ownPiece(parts)(pieceId)
    // A reviewed piece shares its photo with the other pieces found in it; that photo goes with the last.
    const originalShared =
      piece.detectionId !== null && (yield* stored(parts.store.originalInUse(accountId, piece.originalKey, piece.id)))
    const keys = [
      ...new Set(
        [originalShared ? null : piece.originalKey, piece.imageKey, piece.backImageKey].filter(Predicate.isNotNull),
      ),
    ].filter((key) => !originalShared || key !== piece.originalKey)
    yield* Effect.tryPromise({ try: () => parts.bindings.bucket.delete(keys), catch: unavailable })
    const deleted = yield* stored(parts.store.deletePiece(accountId, pieceId))
    if (Option.isNone(deleted)) return yield* PieceNotFound.make({})
  }),
})

const images = (parts: Parts) => ({
  /** The piece's image, resized to WebP by the Images binding. A photo it cannot transform is
   * served as it was stored. */
  pieceImage: Effect.fn('Styld.Wardrobe.pieceImage')(function* (pieceId: PieceId, size: ImageSize) {
    const piece = yield* ownPiece(parts)(pieceId)
    const read = Effect.tryPromise({
      try: () => parts.bindings.bucket.get(piece.imageKey ?? piece.originalKey),
      catch: unavailable,
    }).pipe(
      Effect.flatMap((object) => (object === null ? Effect.fail(PieceNotFound.make({})) : Effect.succeed(object))),
    )
    const object = yield* read
    const image = yield* Effect.tryPromise({
      try: async () => {
        // SAFETY: an R2 object's body is the stored image's bytes -- workers-types declares the body as ReadableStream<any>
        const bytes = object.body as Parameters<WardrobeBindings['images']['input']>[0]
        const result = await parts.bindings.images
          .input(bytes)
          .transform({ width: imageSizes[size], fit: 'scale-down' })
          .output({ format: 'image/webp', quality: 82 })
        return { body: result.image(), contentType: result.contentType() }
      },
      catch: unavailable,
    }).pipe(
      // The transform consumed the first read, so the stored photo is read again.
      Effect.catchTag('WardrobeUnavailable', () =>
        Effect.map(read, (again) => ({
          body: again.body,
          contentType: again.httpMetadata?.contentType ?? piece.contentType,
        })),
      ),
    )
    // Callers only read the picture, so it is typed as any byte stream, Worker or DOM.
    const body: ByteStream = image.body
    return { body, contentType: image.contentType, version: `${piece.id}.${piece.updatedAt.getTime()}.${size}` }
  }),
})

const processing = (parts: Parts) => ({
  /** Run the cut-out step for a piece the queue delivered. Finished pieces are left alone. */
  processPiece: Effect.fn('Styld.Wardrobe.processPiece')(function* (pieceId: string) {
    const row = yield* stored(parts.store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    const { imageKey } = yield* parts.cutout.cut({
      accountId: row.value.accountId,
      pieceId,
      originalKey: row.value.originalKey,
      contentType: row.value.contentType,
    })
    yield* stored(parts.store.finishProcessing(pieceId, { status: 'ready', imageKey, updatedAt: yield* nowDate }))
  }),
  /** The queue gave up on a piece: show it as failed rather than processing forever. */
  failPiece: Effect.fn('Styld.Wardrobe.failPiece')(function* (pieceId: string) {
    const row = yield* stored(parts.store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    yield* parts.cutout.release({ accountId: row.value.accountId, pieceId }).pipe(Effect.mapError(unavailable))
    yield* stored(
      parts.store.finishProcessing(pieceId, { status: 'failed', imageKey: null, updatedAt: yield* nowDate }),
    )
  }),
})

const make = (bindings: WardrobeBindings) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const encoder = new TextEncoder()
    const parts: Parts = {
      bindings,
      store: makeStore(bindings.database),
      cutout: yield* GarmentCutout,
      randomToken: (bytes) =>
        crypto.randomBytes(bytes).pipe(Effect.map(Base64Url.encode), Effect.mapError(unavailable)),
      digest: (text) =>
        crypto.digest('SHA-256', encoder.encode(text)).pipe(Effect.map(Base64Url.encode), Effect.mapError(unavailable)),
    }
    return {
      ...reads(parts),
      ...uploads(parts),
      ...videoUploads(parts),
      ...adding(parts),
      ...editing(parts),
      ...images(parts),
      ...processing(parts),
    }
  })

/** One implementation of every wardrobe operation. HTTP and MCP are projections of it; both provide
 * `CurrentAccount`, so an operation never takes whose wardrobe it is from its input. */
export class Wardrobe extends Context.Service<Wardrobe, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Wardrobe',
) {}

/** The wardrobe over the Worker's bindings. Build it once per isolate and share it between the
 * routes and the queue consumer. */
export const makeWardrobe = (bindings: WardrobeBindings) =>
  Effect.map(make(bindings), (service) => Wardrobe.of(service))
