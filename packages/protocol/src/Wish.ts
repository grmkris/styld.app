import { Schema } from 'effect'
import { Author, PublicPiece } from './Public.ts'
import { Category, PieceId } from './Wardrobe.ts'

// What the person wants one like: someone's public piece, kept private. A wish outlives its piece: it keeps the
// name and what it was, and shows no picture once the piece is gone or no longer public.

export const WishId = Schema.String.check(Schema.isPattern(/^ws_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('WishId'))
export type WishId = typeof WishId.Type

export const Wish = Schema.Struct({
  id: WishId,
  name: Schema.NullOr(Schema.String),
  category: Category,
  /** The piece as others see it, while it is still public; null once it is gone. */
  piece: Schema.NullOr(PublicPiece),
  by: Schema.NullOr(Author),
  createdAt: Schema.String,
})
export type Wish = typeof Wish.Type

export const Wishes = Schema.Struct({ wishes: Schema.Array(Wish) })
export type Wishes = typeof Wishes.Type

export const AddWish = Schema.Struct({ pieceId: PieceId })
export type AddWish = typeof AddWish.Type
