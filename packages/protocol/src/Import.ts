import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { NotFound, Unavailable } from './Errors.ts'
import { PieceType } from './Garment.ts'
import { Operation } from './Ids.ts'
import { SessionAccount } from './Session.ts'
import { Name } from './Text.ts'
import { Colours, ImageType, PieceId, PieceStatus } from './Wardrobe.ts'

// Bringing a wardrobe over from the first Styld (v1) at the switch, run by the operator's importer (`tools/import-v1`).
// The importer puts a bundle in the media bucket under `imports/<importId>/`: this manifest, and each piece's picture
// beside it. Only Styld's admins (`STYLD_ADMIN_EMAILS`) may start or read an import; to anyone else it is not there.

/** An import's id: its bundle's folder under `imports/`. */
export const ImportId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/u))
export type ImportId = typeof ImportId.Type

/** One piece to import: its v1 id (its receipt, so it is imported once whatever bundle carries it), what it is, and its
 * picture's file in the bundle. */
export const ImportPiece = Schema.Struct({
  v1Id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  name: Schema.optionalKey(Name),
  type: PieceType,
  colours: Colours,
  picture: Schema.String.check(Schema.isPattern(/^pictures\/[A-Za-z0-9_-]{1,120}$/u)),
  contentType: ImageType,
})
export type ImportPiece = typeof ImportPiece.Type

/** The bundle's `manifest.json`: whose wardrobe, by the email they sign in with, and its pieces. */
export const ImportManifest = Schema.Struct({
  version: Schema.Literal(1),
  email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320)),
  /** The name an account made for the import starts with. */
  displayName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  pieces: Schema.Array(ImportPiece),
})
export type ImportManifest = typeof ImportManifest.Type

/** Where one imported piece stands: not made yet, or its piece and how its processing goes. */
export const ImportedPiece = Schema.Struct({
  v1Id: Schema.String,
  pieceId: Schema.NullOr(PieceId),
  status: Schema.Literals(['waiting', ...PieceStatus.literals]),
})
export type ImportedPiece = typeof ImportedPiece.Type

/** An import as it stands: the account it goes into, and each of its pieces. */
export const ImportStatus = Schema.Struct({
  importId: ImportId,
  accountId: Schema.String,
  pieces: Schema.Array(ImportedPiece),
})
export type ImportStatus = typeof ImportStatus.Type

/** An import started: as it stands, and whether its account was made for it (the email had none). */
export const ImportStarted = Schema.Struct({ ...ImportStatus.fields, accountCreated: Schema.Boolean })
export type ImportStarted = typeof ImportStarted.Type

/** Imports, for Styld's admins. Starting one again sends only what is not imported yet. */
export class ImportApi extends HttpApiGroup.make('import')
  .add(
    HttpApiEndpoint.post('startImport', '/admin/imports/:importId', {
      params: { importId: ImportId },
      payload: Operation,
      success: ImportStarted,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('importStatus', '/admin/imports/:importId', {
      params: { importId: ImportId },
      success: ImportStatus,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
