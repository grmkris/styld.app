import { Schema } from 'effect'
import { CheckStatus } from './Check.ts'
import { OperationId, Piece, PieceId } from './Wardrobe.ts'

export const LookId = Schema.String.check(Schema.isPattern(/^lk_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('LookId'))
export type LookId = typeof LookId.Type

const Label = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))

/** The most pieces one look holds: a full outfit with its accessories. */
export const maximumLookPieces = 12

/** A look an assistant puts together from the person's own pieces, in the order it shows them. */
export const CreateLook = Schema.Struct({
  operationId: OperationId,
  name: Label,
  occasion: Schema.optionalKey(Label),
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
