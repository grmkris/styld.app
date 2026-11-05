import {
  type AddPiece,
  type CreateUpload,
  type CreateVideoUpload,
  CurrentAccount,
  type DeletePieces,
  NoCleanPicture,
  NotFound,
  ChoosePicture,
  Piece,
  type OperationId,
  type PieceId,
  type UpdatePiece,
  Upload,
  UploadId,
  UploadRefused,
} from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Option, Predicate } from 'effect'
import { type ByteStream, pump } from '../Streams.ts'
import { isVideoContainer, sniffImageType, uploadKey } from './Media.ts'
import { backing } from './Back.ts'
import { searching } from './Search.ts'
import { PieceQueue } from './Processing.ts'
import { processing } from './Work.ts'
import {
  ownerPiece,
  forgetObjects,
  ownPiece,
  pictureRow,
  refused,
  stored,
  spelled,
  toPiece,
  unavailable,
  usableUpload,
  type WardrobeServices,
} from './Shared.ts'
import { nowDate } from '../kernel/Db.ts'
import { admitUpload } from './Admission.ts'
import { owedPieceOf, type PieceRow, type ReceiptRow, type UploadRow, WardrobeStore } from './Store.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { digestOf, randomToken } from '../kernel/Ids.ts'
import { deleting, once, type Operation } from '../kernel/Receipts.ts'
import { identify, priorResult, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { Media } from '../kernel/Media.ts'
import { clearOwed } from '../kernel/MediaDeletions.ts'

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

const enqueue = (pieceId: string) =>
  Effect.flatMap(PieceQueue, (queue) =>
    Effect.tryPromise({ try: () => queue.send({ _tag: 'ProcessPiece', pieceId }), catch: unavailable }),
  )

const reads = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  listPieces: Effect.fn('Styld.Wardrobe.listPieces')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored((yield* WardrobeStore).listPieces(accountId))
    const pictures = new Map(
      (yield* stored((yield* WardrobeStore).picturesOf(accountId))).map((row) => [row.pieceId, row]),
    )
    const turns = new Map((yield* stored((yield* WardrobeStore).turnsOf(accountId))).map((row) => [row.pieceId, row]))
    return yield* Effect.forEach(rows, (row) => toPiece(row, pictures.get(row.id), turns.get(row.id)))
  }, Effect.provide(context)),
  getPiece: Effect.fn('Styld.Wardrobe.getPiece')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    return yield* ownerPiece(accountId, yield* ownPiece(pieceId))
  }, Effect.provide(context)),
}))

/** The upload a path's token unlocks. A wrong token, and an account closed for deletion, both read as
 * not found. */
const tokenUpload = (uploadId: string, token: string) =>
  Effect.gen(function* () {
    const row = yield* stored((yield* WardrobeStore).findUpload(uploadId))
    if (Option.isNone(row) || (yield* digestOf(token)) !== row.value.tokenDigest) return yield* refused('notFound')
    if (!(yield* stored((yield* WardrobeStore).accountEnabled(row.value.accountId)))) return yield* refused('notFound')
    return row.value
  })

/** The upload path for a token. */
const uploadPath = (uploadId: string, token: string) => `/api/uploads/${uploadId}?token=${token}`

/** The upload an operation made, answered again with a fresh token: the first answer, and its token, were lost. */
const reissued = (accountId: string, uploadId: string) =>
  Effect.gen(function* () {
    const row = yield* stored((yield* WardrobeStore).findUpload(uploadId))
    if (Option.isNone(row) || row.value.accountId !== accountId) return yield* refused('notFound')
    const token = yield* randomToken(32)
    yield* stored((yield* WardrobeStore).reissueUpload(uploadId, yield* digestOf(token)))
    const upload: typeof Upload.Type = {
      uploadId: UploadId.make(uploadId),
      path: uploadPath(uploadId, token),
      expiresAt: row.value.expiresAt.toISOString(),
    }
    return upload
  })

/** A one-time upload path for a file of this type and size; its token is stored only as a digest. */
const newUpload = Effect.fn('Styld.Wardrobe.newUpload')(function* (input: {
  readonly contentType: UploadRow['contentType']
  readonly bytes: number
}) {
  const { accountId } = yield* CurrentAccount
  const uploadId = `up_${yield* randomToken(16)}`
  const token = yield* randomToken(32)
  const expiresAt = DateTime.toDateUtc(DateTime.add(yield* DateTime.now, uploadLifetime))
  yield* stored(
    (yield* WardrobeStore).insertUpload({
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

const uploads = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  /** An upload Styld makes itself, for picture bytes it holds: an import, a photo pinned on a board. */
  newUpload: (input: Parameters<typeof newUpload>[0]) => newUpload(input).pipe(Effect.provide(context)),
  /** Hand out a one-time upload path; repeating the operation answers the same upload with a fresh token. */
  createUpload: Effect.fn('Styld.Wardrobe.createUpload')(function* (
    input: typeof CreateUpload.Type | typeof CreateVideoUpload.Type,
  ) {
    const { accountId } = yield* CurrentAccount
    const { operationId, ...file } = input
    return yield* once(
      yield* WardrobeStore,
      { accountId, operationId, command: 'createUpload', input: file },
      {
        replay: (uploadId) => reissued(accountId, uploadId),
        run: Effect.andThen(
          admitUpload(file.bytes),
          Effect.map(newUpload(file), (upload) => [upload, upload.uploadId] as const),
        ),
      },
    )
  }, Effect.provide(context)),
  /** Store a photo's bytes against its upload. The token is the only credential. */
  receiveUpload: Effect.fn('Styld.Wardrobe.receiveUpload')(function* (input: {
    readonly uploadId: string
    readonly token: string
    readonly contentType: string
    readonly body: Uint8Array
  }) {
    const upload = yield* tokenUpload(input.uploadId, input.token)
    const refusal = receiveRefusal(upload, input, DateTime.toEpochMillis(yield* DateTime.now))
    if (Option.isSome(refusal)) return yield* refused(refusal.value)
    const { bucket } = yield* Media
    yield* Effect.tryPromise({
      try: () => bucket.put(upload.objectKey, input.body, { httpMetadata: { contentType: upload.contentType } }),
      catch: unavailable,
    })
    yield* stored((yield* WardrobeStore).markUploadReceived(upload.id))
  }, Effect.provide(context)),
}))

/** Stream a body of a known length into the bucket. A FixedLengthStream tells R2 the length up front,
 * and fails if the body is any other length. */
const streamInto = (key: string, contentType: string, bytes: number, body: ByteStream) =>
  Effect.flatMap(Media, ({ bucket }) =>
    Effect.tryPromise({
      try: async () => {
        const { readable, writable } = new FixedLengthStream(bytes)
        const writer = writable.getWriter()
        await Promise.all([
          // SAFETY: FixedLengthStream's readable is the Worker runtime's stream R2 takes -- the global ReadableStream name resolves to the DOM lib's here
          bucket.put(key, readable as never, { httpMetadata: { contentType } }),
          pump(body, { write: (chunk) => writer.write(chunk), close: () => writer.close() }),
        ])
      },
      catch: unavailable,
    }),
  )

/** The first bytes of a stored object, enough for a container signature. */
const storedHead = (key: string) =>
  Effect.flatMap(Media, ({ bucket }) =>
    Effect.tryPromise({
      try: async () => {
        const object = await bucket.get(key, { range: { offset: 0, length: 12 } })
        return object === null ? new Uint8Array() : new Uint8Array(await object.arrayBuffer())
      },
      catch: unavailable,
    }),
  )

const videoUploads = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  /** Store a video's bytes against its upload, streamed into the bucket rather than read whole. The
   * stream must be exactly the declared length, and the stored bytes must be an MP4 or MOV file. */
  receiveVideoUpload: Effect.fn('Styld.Wardrobe.receiveVideoUpload')(function* (input: {
    readonly uploadId: string
    readonly token: string
    readonly contentType: string
    readonly bytes: number
    readonly body: ByteStream
  }) {
    const upload = yield* tokenUpload(input.uploadId, input.token)
    const refusal = videoRefusal(upload, input, DateTime.toEpochMillis(yield* DateTime.now))
    if (Option.isSome(refusal)) return yield* refused(refusal.value)
    yield* streamInto(upload.objectKey, upload.contentType, input.bytes, input.body)
    if (!isVideoContainer(yield* storedHead(upload.objectKey))) {
      const { bucket } = yield* Media
      yield* Effect.tryPromise({ try: () => bucket.delete(upload.objectKey), catch: unavailable })
      return yield* refused('notAnImage')
    }
    yield* stored((yield* WardrobeStore).markUploadReceived(upload.id))
  }, Effect.provide(context)),
}))

/** The answer to an operation id that was already used: the same piece, never a second one. */
const replay = (accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    const row = yield* stored((yield* WardrobeStore).findPiece(accountId, pieceId))
    if (Option.isNone(row)) return yield* refused('alreadyUsed')
    // A replay after a lost queue message schedules the processing again; processing is idempotent.
    if (row.value.status === 'processing') yield* enqueue(row.value.id).pipe(Effect.ignore)
    return yield* toPiece(row.value)
  })

/** A batch the store refused. If the same operation committed after all (a lost answer or a
 * concurrent repeat), its receipt answers; otherwise another operation used the upload, or D1
 * failed. */
const addFailure = (operation: Identified, uploadId: string) =>
  Effect.gen(function* () {
    const prior = yield* priorResult(
      operation,
      yield* stored((yield* WardrobeStore).findReceipt(operation.accountId, operation.operationId)),
    )
    if (Option.isSome(prior)) return yield* replay(operation.accountId, prior.value)
    const latest = yield* stored((yield* WardrobeStore).findUpload(uploadId))
    return yield* Option.exists(latest, ({ status }) => status === 'used') ? refused('alreadyUsed') : unavailable()
  })

const newPiece = (
  input: AddPiece,
  upload: UploadRow,
  context: {
    readonly id: string
    readonly via: 'session' | 'assistant'
    readonly now: Date
    readonly category: string | null
  },
): PieceRow => ({
  id: context.id,
  accountId: upload.accountId,
  name: input.name ?? null,
  notes: null,
  type: input.type,
  colours: input.colours ?? [],
  seasons: input.seasons ?? [],
  rainproof: input.rainproof ?? false,
  category: context.category,
  occasions: input.occasions ?? [],
  pattern: input.pattern ?? null,
  brand: input.brand ?? null,
  shopUrl: input.shopUrl ?? null,
  detectionId: null,
  backImageKey: null,
  rotation: 0,
  status: 'processing',
  source: context.via === 'assistant' ? 'assistant' : 'website',
  uploadId: upload.id,
  originalKey: upload.objectKey,
  imageKey: null,
  contentType: upload.contentType,
  createdAt: context.now,
  updatedAt: context.now,
})

const adding = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  addPiece: Effect.fn('Styld.Wardrobe.addPiece')(function* (input: AddPiece) {
    const { accountId, via } = yield* CurrentAccount
    const { operationId, ...meaning } = input
    const operation = yield* identify({ accountId, operationId, command: 'addPiece', input: meaning })
    const prior = yield* priorResult(
      operation,
      yield* stored((yield* WardrobeStore).findReceipt(accountId, operationId)),
    )
    if (Option.isSome(prior)) return yield* replay(accountId, prior.value)
    const upload = yield* usableUpload(accountId, input.uploadId)
    const now = yield* nowDate
    const category = input.category === undefined ? null : yield* spelled(accountId, input.type, input.category)
    const row = newPiece(input, upload, { id: `pc_${yield* randomToken(16)}`, via, now, category })
    const committed = yield* (yield* WardrobeStore).addPiece(row, yield* receiptRow(operation, row.id)).pipe(
      Effect.as(Option.none<Piece>()),
      Effect.catchTag('StoreUnavailable', () => addFailure(operation, input.uploadId).pipe(Effect.map(Option.some))),
    )
    if (Option.isSome(committed)) return committed.value
    // The piece is stored; if its message is lost, the add answers retryable and the retry with
    // the same operation id replays it, which schedules the processing again.
    yield* enqueue(row.id)
    return yield* toPiece(row)
  }, Effect.provide(context)),
}))

const editing = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  /** Show the clean drawing or the photo. Only a drawing that is ready or proposed can be chosen. */
  choosePicture: Effect.fn('Styld.Wardrobe.choosePicture')(function* (
    pieceId: PieceId,
    input: typeof ChoosePicture.Type,
  ) {
    const { accountId } = yield* CurrentAccount
    const store = yield* WardrobeStore
    const { use, operationId } = input
    const write = Effect.gen(function* () {
      yield* ownPiece(pieceId)
      const picture = yield* pictureRow(accountId, pieceId)
      if (picture?.state !== 'ready' && picture?.state !== 'proposed') return yield* NoCleanPicture.make({})
      return { statements: [store.choosePicture(accountId, pieceId, use, yield* nowDate)], result: pieceId }
    })
    return yield* store.recorded(
      { accountId, operationId, command: 'choosePicture', input: [pieceId, use] },
      {
        write,
        answer: () =>
          Effect.gen(function* () {
            // What it shows is what others see of it: a public piece is checked again (no change, no new check).
            yield* (yield* PieceChanged).changed(pieceId)
            return yield* ownerPiece(accountId, yield* ownPiece(pieceId))
          }),
      },
    )
  }, Effect.provide(context)),
  /** Change the piece's words and labels, once per operation id: a repeat answers the piece as it is now and writes
   * nothing, so it never undoes a later edit. */
  updatePiece: Effect.fn('Styld.Wardrobe.updatePiece')(function* (pieceId: PieceId, input: UpdatePiece) {
    const { accountId } = yield* CurrentAccount
    const store = yield* WardrobeStore
    const { operationId, ...changes } = input
    const write = Effect.gen(function* () {
      const piece = yield* ownPiece(pieceId)
      // A category is the person's own under the piece's type, spelled as they already spell it (T-12).
      const category =
        changes.category === undefined || changes.category === null
          ? changes.category
          : yield* spelled(accountId, changes.type ?? piece.type, changes.category)
      const update = store.updatePiece(accountId, pieceId, {
        ...changes,
        ...(category === undefined ? {} : { category }),
        updatedAt: yield* nowDate,
      })
      return { statements: [update], result: pieceId }
    })
    return yield* store.recorded(
      { accountId, operationId, command: 'updatePiece', input: [pieceId, changes] },
      {
        write,
        answer: () =>
          Effect.gen(function* () {
            // Its name is what others read of it: a public piece renamed is checked again before they see the new
            // name; the same name asks for nothing.
            if (changes.name !== undefined) yield* (yield* PieceChanged).changed(pieceId)
            return yield* ownerPiece(accountId, yield* ownPiece(pieceId))
          }),
      },
    )
  }, Effect.provide(context)),
  /** Delete a piece: its row, upload and check first, then its photo, cut-outs, back and drawings, except what another
   * piece or a tray card still shows (a reviewed piece shares its photo with the others found in it). A repeat of the
   * same delete answers done. */
  deletePiece: Effect.fn('Styld.Wardrobe.deletePiece')(function* (pieceId: PieceId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const deletion = { accountId, operationId, command: 'deletePiece', target: pieceId }
    yield* deleting(yield* WardrobeStore, deletion, (receipt) =>
      Effect.flatMap(ownPiece(pieceId), (piece) => removePieces(accountId, [piece], receipt)),
    )
  }, Effect.provide(context)),
  /** Delete several pieces at once, as `deletePiece` deletes one. A piece already gone is skipped, since gone is what
   * was asked for; another account's piece is `NotFound`, and then nothing is deleted. A repeat answers done. */
  deletePieces: Effect.fn('Styld.Wardrobe.deletePieces')(function* (input: DeletePieces) {
    const { accountId } = yield* CurrentAccount
    const store = yield* WardrobeStore
    const pieceIds = [...new Set(input.pieceIds)]
    const deletion = { accountId, operationId: input.operationId, command: 'deletePieces', target: pieceIds }
    yield* deleting(store, deletion, (receipt) =>
      Effect.gen(function* () {
        const found = yield* stored(store.piecesWithIds(pieceIds))
        if (found.some((piece) => piece.accountId !== accountId)) return yield* NotFound.make({})
        yield* removePieces(accountId, found, receipt)
      }),
    )
  }, Effect.provide(context)),
}))

/** Delete the account's pieces' rows with the delete's receipt, then the objects only they showed (`forgetObjects`):
 * their photo, image and back, and everything under each piece's own prefix, which the delete recorded as owed
 * (`kernel/MediaDeletions.ts`), so what R2 cannot remove now the sweep removes later. */
const removePieces = (accountId: string, rows: ReadonlyArray<PieceRow>, receipt: ReceiptRow) =>
  Effect.gen(function* () {
    const store = yield* WardrobeStore
    yield* stored(store.deletePieces(accountId, rows, receipt))
    const shown = rows.flatMap((piece) => [piece.originalKey, piece.imageKey, piece.backImageKey])
    yield* forgetObjects(accountId, shown.filter(Predicate.isNotNull), 'piece')
    yield* clearOwed(
      store.owedMedia,
      (yield* Media).bucket,
      rows.map(({ id }) => owedPieceOf(accountId, id)),
    )
  })

/** Every wardrobe operation, each group built over the services it yields (`Shared.ts` `WardrobeServices`). */
const make = Effect.gen(function* () {
  const store = yield* WardrobeStore
  return {
    ...(yield* reads),
    ...(yield* searching),
    ...(yield* uploads),
    ...(yield* videoUploads),
    ...(yield* adding),
    ...(yield* editing),
    ...(yield* backing),
    ...(yield* processing),
    /** An operation of the person's whose work is not one D1 batch, answered once per operation id from the
     * receipts (`kernel/Receipts.ts`): reading a shop's page into an upload. */
    once: <A, E, R, E2, R2>(
      operation: Omit<Operation, 'accountId'>,
      answer: Parameters<typeof once<A, E, R, E2, R2>>[2],
    ) => Effect.flatMap(CurrentAccount, ({ accountId }) => once(store, { ...operation, accountId }, answer)),
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
