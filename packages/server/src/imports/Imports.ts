import {
  type ImportedPiece,
  ImportManifest,
  type ImportPiece,
  type ImportStarted,
  type ImportStatus,
  NotFound,
  PieceId,
  Unavailable,
} from '@styld/protocol'
import { Array, Context, Effect, Layer, Option, Schema } from 'effect'
import { AccountLifecycle } from '../AccountLifecycle.ts'
import { Deployment } from '../Config.ts'
import { first, nowDate } from '../kernel/Db.ts'
import { digestOf, newId, randomToken } from '../kernel/Ids.ts'
import { Media } from '../kernel/Media.ts'
import { isAdmin } from '../social/Curation.ts'
import { sniffImageType, uploadKey } from '../wardrobe/Media.ts'
import type { PieceRow, UploadRow } from '../wardrobe/Store.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { type ImportMessage, ImportQueue } from './Queue.ts'
import { ImportStore } from './Store.ts'

// A wardrobe brought over from v1 at the switch (owner, 2026-11-01): the operator's importer (`tools/import-v1`) puts
// a bundle under `imports/<importId>/` and an admin starts it. The account is the one the bundle's email signs in to,
// made for it when there is none (the person later signs in with the usual email code and finds their wardrobe). Each
// v1 piece is imported into an account once (`imported_pieces`, whichever bundle carries it), on the import queue at
// the pace Cloudflare Images keeps; it is cut out and described by the decision model as it is imported, paid by Styld,
// never the account's credits.

const unavailable = () => Unavailable.make({})
const stored = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.mapError(effect, unavailable)

/** Queues take at most this many messages a call. */
const sendBatch = 100

/** An import is an admin's: to anyone else it is not there. */
const asAdmin = Effect.gen(function* () {
  const account = yield* (yield* AccountLifecycle).readAccount()
  if (!isAdmin((yield* Deployment).admins, account)) return yield* NotFound.make({})
})

/** The bundle's manifest; none when there is no such import. */
const manifestOf = Effect.fnUntraced(function* (importId: string) {
  const { bucket } = yield* Media
  const object = yield* Effect.tryPromise({
    try: () => bucket.get(`imports/${importId}/manifest.json`),
    catch: unavailable,
  })
  if (object === null) return yield* NotFound.make({})
  const text = yield* Effect.tryPromise({ try: () => object.text(), catch: unavailable })
  // A bundle the importer wrote is always a manifest; anything else is an operator's mistake to see in the logs.
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ImportManifest))(text).pipe(Effect.orDie)
})

/** The account the manifest's email signs in to, made for it when there is none. */
const accountFor = Effect.fnUntraced(function* (manifest: ImportManifest) {
  const store = yield* ImportStore
  const found = yield* stored(store.accountOf(manifest.email))
  if (Option.isSome(found)) return { accountId: found.value.accountId, created: false }
  const account = {
    accountId: yield* randomToken(32),
    credentialId: yield* randomToken(32),
    securityRevision: yield* randomToken(32),
    bindingRevision: yield* randomToken(32),
    credentialRevision: yield* randomToken(32),
    email: manifest.email,
    displayName: manifest.displayName,
    at: yield* nowDate,
  }
  const made = yield* store.createAccount(account).pipe(Effect.option)
  if (Option.isSome(made)) return { accountId: account.accountId, created: true }
  // Another start made it first: the address is taken by that account now.
  const again = yield* stored(store.accountOf(manifest.email))
  if (Option.isSome(again)) return { accountId: again.value.accountId, created: false }
  return yield* unavailable()
})

/** Each piece of the manifest as it stands in the account. */
const piecesIn = Effect.fnUntraced(function* (accountId: string, manifest: ImportManifest) {
  const store = yield* ImportStore
  const imported = yield* stored(
    store.importedOf(
      accountId,
      manifest.pieces.map(({ v1Id }) => v1Id),
    ),
  )
  const made = new Map(imported.map(({ v1Id, pieceId }) => [v1Id, pieceId]))
  const statuses = new Map(
    (yield* stored(store.statusesOf(accountId, [...made.values()]))).map(({ id, status }) => [id, status]),
  )
  return manifest.pieces.map(({ v1Id }): ImportedPiece => {
    const pieceId = made.get(v1Id)
    return pieceId === undefined
      ? { v1Id, pieceId: null, status: 'waiting' }
      : { v1Id, pieceId: PieceId.make(pieceId), status: statuses.get(pieceId) ?? 'failed' }
  })
})

/** The rows an imported piece is made of: its photo's upload, stored by Styld and taken at once, and the piece. */
const rowsOf = Effect.fnUntraced(function* (accountId: string, piece: ImportPiece, bytes: number) {
  const at = yield* nowDate
  const uploadId = yield* newId('up')
  const upload: UploadRow = {
    id: uploadId,
    accountId,
    // No path is ever handed out for it: its token is a digest of nothing anyone holds.
    tokenDigest: yield* digestOf(yield* randomToken(32)),
    contentType: piece.contentType,
    bytes,
    objectKey: uploadKey(accountId, uploadId),
    status: 'used',
    expiresAt: at,
  }
  const row: PieceRow = {
    id: yield* newId('pc'),
    accountId,
    name: piece.name ?? null,
    notes: null,
    type: piece.type,
    colours: piece.colours,
    season: null,
    occasions: [],
    pattern: null,
    brand: null,
    shopUrl: null,
    status: 'processing',
    source: 'import',
    uploadId,
    detectionId: null,
    backImageKey: null,
    originalKey: upload.objectKey,
    imageKey: null,
    contentType: piece.contentType,
    createdAt: at,
    updatedAt: at,
  }
  return { upload, row }
})

/** The piece the account's v1 piece became, if it was imported. */
const importedAs = (accountId: string, v1Id: string) =>
  Effect.flatMap(ImportStore, (store) =>
    stored(store.importedOf(accountId, [v1Id])).pipe(
      Effect.map((rows) => Option.map(first(rows), (row) => row.pieceId)),
    ),
  )

/** The piece a delivery imports: the one the v1 piece already became, or a new one made from the bundle's picture. */
const pieceOf = Effect.fnUntraced(function* (message: ImportMessage) {
  const store = yield* ImportStore
  const { accountId, importId, piece } = message
  const earlier = () => importedAs(accountId, piece.v1Id)
  const prior = yield* earlier()
  if (Option.isSome(prior)) return prior.value
  const { bucket } = yield* Media
  const object = yield* Effect.tryPromise({
    try: () => bucket.get(`imports/${importId}/${piece.picture}`),
    catch: unavailable,
  })
  if (object === null) return yield* NotFound.make({})
  const bytes = new Uint8Array(yield* Effect.tryPromise({ try: () => object.arrayBuffer(), catch: unavailable }))
  if (!Option.contains(sniffImageType(bytes), piece.contentType)) return yield* NotFound.make({})
  const { upload, row } = yield* rowsOf(accountId, piece, bytes.byteLength)
  yield* Effect.tryPromise({
    try: () => bucket.put(upload.objectKey, bytes, { httpMetadata: { contentType: piece.contentType } }),
    catch: unavailable,
  })
  const made = yield* store.createPiece(upload, row, piece.v1Id).pipe(Effect.option)
  if (Option.isSome(made)) return row.id
  // A delivery that raced this one made it; its photo is the one kept, this copy goes with the account.
  return yield* Effect.flatMap(earlier(), Option.match({ onNone: unavailable, onSome: Effect.succeed }))
})

const make = Effect.gen(function* () {
  const context = yield* Effect.context<AccountLifecycle | Deployment | Media | ImportStore | ImportQueue | Wardrobe>()
  return {
    /** Start an import as an admin: its account, found or made, and every piece not imported yet sent to the queue. */
    startImport: Effect.fn('Styld.Imports.start')(function* (importId: string) {
      yield* asAdmin
      const manifest = yield* manifestOf(importId)
      const { accountId, created } = yield* accountFor(manifest)
      const pieces = yield* piecesIn(accountId, manifest)
      const waiting = manifest.pieces.filter((_, index) => pieces[index]?.pieceId === null)
      const queue = yield* ImportQueue
      yield* Effect.forEach(
        Array.chunksOf(waiting, sendBatch),
        (chunk) =>
          Effect.tryPromise({
            try: () =>
              queue.sendBatch(chunk.map((piece) => ({ body: { _tag: 'ImportPiece', importId, accountId, piece } }))),
            catch: unavailable,
          }),
        { discard: true },
      )
      yield* Effect.annotateCurrentSpan({
        'styld.import.pieces': manifest.pieces.length,
        'styld.import.sent': waiting.length,
      })
      return { importId, accountId, pieces, accountCreated: created } satisfies ImportStarted
    }, Effect.provide(context)),
    /** An import as it stands, as an admin. */
    importStatus: Effect.fn('Styld.Imports.status')(function* (importId: string) {
      yield* asAdmin
      const manifest = yield* manifestOf(importId)
      const found = yield* stored((yield* ImportStore).accountOf(manifest.email))
      if (Option.isNone(found)) return yield* NotFound.make({})
      const { accountId } = found.value
      return { importId, accountId, pieces: yield* piecesIn(accountId, manifest) } satisfies ImportStatus
    }, Effect.provide(context)),
    /** Import one piece and process it: cut out and described, paid by Styld. */
    importPiece: Effect.fn('Styld.Imports.piece')(function* (message: ImportMessage) {
      const pieceId = yield* pieceOf(message)
      yield* (yield* Wardrobe).processPiece(pieceId)
    }, Effect.provide(context)),
    /** The queue gave up on a piece: one that was made shows as failed rather than processing forever. */
    giveUpPiece: Effect.fn('Styld.Imports.giveUp')(function* (message: ImportMessage) {
      const { accountId, piece } = message
      const pieceId = yield* importedAs(accountId, piece.v1Id)
      if (Option.isSome(pieceId)) yield* (yield* Wardrobe).failPiece(pieceId.value)
    }, Effect.provide(context)),
  }
})

/** Imports of v1 wardrobes, for Styld's admins and the import queue. */
export class Imports extends Context.Service<Imports, Effect.Success<typeof make>>()('@styld/server/imports/Imports') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Imports.of(service)),
  )
}
