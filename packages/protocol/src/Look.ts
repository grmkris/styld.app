import { maximumLookPieces } from './Limits.ts'
import { Name } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { CheckStatus } from './Check.ts'
import { Piece, PieceId } from './Wardrobe.ts'

export const LookId = entityId('lk').pipe(Schema.brand('LookId'))
export type LookId = typeof LookId.Type

/** A look an assistant puts together from the person's own pieces, in the order it shows them. */
export const CreateLook = Schema.Struct({
  operationId: OperationId,
  name: Name,
  occasion: Schema.optionalKey(Name),
  pieceIds: Schema.Array(PieceId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumLookPieces)),
})
export type CreateLook = typeof CreateLook.Type

export const Look = Schema.Struct({
  id: LookId,
  name: Schema.String,
  occasion: Schema.NullOr(Schema.String),
  /** Its pieces still in the wardrobe; a deleted piece leaves its looks. */
  pieces: Schema.Array(Piece),
  /** Shared looks are on the profile once their check lets them. */
  shared: Schema.Boolean,
  check: Schema.NullOr(CheckStatus),
  createdAt: Schema.String,
})
export type Look = typeof Look.Type

export const Looks = Schema.Struct({ looks: Schema.Array(Look) })
