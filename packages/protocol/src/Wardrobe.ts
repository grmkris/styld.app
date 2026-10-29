import { Schema } from 'effect'

/** The six wardrobe categories, keyed as in v1 so a piece's category reads the same everywhere. */
export const Category = Schema.Literals(['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'])
export type Category = typeof Category.Type

/** Every shelf a piece can sit on. `sport` is a shelf in each wearable category; `other` fits any. */
export const Subcategory = Schema.Literals([
  'short_sleeve',
  'long_sleeve',
  'sleeveless',
  'jeans',
  'trousers',
  'leggings',
  'shorts',
  'skirts',
  'loungewear',
  'mini',
  'midi',
  'maxi',
  'coats',
  'jackets',
  'blazers',
  'vests',
  'sneakers',
  'boots',
  'heels',
  'sandals',
  'flats',
  'glasses',
  'belts',
  'bags',
  'scarves',
  'hats',
  'jewelry',
  'sport',
  'other',
])
export type Subcategory = typeof Subcategory.Type

/** The shelves inside each category, in the order the wardrobe shows them (v1
 * `wardrobe-subcategories.ts`). */
export const subcategories: { readonly [Key in Category]: ReadonlyArray<Subcategory> } = {
  top: ['short_sleeve', 'long_sleeve', 'sleeveless', 'sport', 'other'],
  bottom: ['jeans', 'trousers', 'leggings', 'shorts', 'skirts', 'loungewear', 'sport', 'other'],
  dress: ['mini', 'midi', 'maxi', 'sport', 'other'],
  outerwear: ['coats', 'jackets', 'blazers', 'vests', 'sport', 'other'],
  shoes: ['sneakers', 'boots', 'heels', 'sandals', 'flats', 'sport', 'other'],
  accessory: ['glasses', 'belts', 'bags', 'scarves', 'hats', 'jewelry', 'other'],
}

export const subcategoryFits = (category: Category, subcategory: Subcategory) =>
  subcategories[category].includes(subcategory)

/** The thirteen plain colours a person can pick (v1's `CATALOG_COLORS`). */
export const Colour = Schema.Literals([
  'black',
  'white',
  'grey',
  'beige',
  'brown',
  'navy',
  'blue',
  'green',
  'red',
  'pink',
  'yellow',
  'orange',
  'purple',
])
export type Colour = typeof Colour.Type

/** A piece's colours: distinct, at most six. */
export const Colours = Schema.Array(Colour).check(Schema.isUnique(), Schema.isMaxLength(6))

/** Opaque ids: a kind prefix and 22 base64url characters (16 random bytes). */
export const PieceId = Schema.String.check(Schema.isPattern(/^pc_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('PieceId'))
export type PieceId = typeof PieceId.Type
export const UploadId = Schema.String.check(Schema.isPattern(/^up_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('UploadId'))
export type UploadId = typeof UploadId.Type

/** Chosen by the caller once per intended change; repeating it repeats the answer, never the change. */
export const OperationId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/)).pipe(
  Schema.brand('OperationId'),
)
export type OperationId = typeof OperationId.Type

/** Photos Styld accepts. HEIC is not among them yet: browsers convert it to JPEG on upload. */
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
export type ImageType = typeof ImageType.Type

export const maximumImageBytes = 15 * 1024 * 1024

const Name = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
const Notes = Schema.String.check(Schema.isMaxLength(500))

/** A piece waits in `processing` while its photo is prepared, then shows as `ready`. */
export const PieceStatus = Schema.Literals(['processing', 'ready', 'failed'])
export type PieceStatus = typeof PieceStatus.Type

/** Who added the piece: the person on the website, or an assistant on their behalf. */
export const PieceSource = Schema.Literals(['website', 'assistant'])

export const Piece = Schema.Struct({
  id: PieceId,
  name: Schema.NullOr(Name),
  notes: Schema.NullOr(Notes),
  category: Category,
  subcategory: Schema.NullOr(Subcategory),
  colours: Colours,
  status: PieceStatus,
  source: PieceSource,
  /** ISO 8601 instants. */
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Piece = typeof Piece.Type

export const Pieces = Schema.Struct({ pieces: Schema.Array(Piece) })

export const CreateUpload = Schema.Struct({
  contentType: ImageType,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumImageBytes })),
})

/** Where to send the photo's bytes: `PUT` the exact `path`, with the declared content type and
 * length, before `expiresAt`. The path carries a one-time token, so treat it as a secret. */
export const Upload = Schema.Struct({ uploadId: UploadId, path: Schema.String, expiresAt: Schema.String })

export const AddPiece = Schema.Struct({
  operationId: OperationId,
  uploadId: UploadId,
  category: Category,
  subcategory: Schema.optionalKey(Subcategory),
  colours: Schema.optionalKey(Colours),
  name: Schema.optionalKey(Name),
})
export type AddPiece = typeof AddPiece.Type

export const UpdatePiece = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Name)),
  notes: Schema.optionalKey(Schema.NullOr(Notes)),
  category: Schema.optionalKey(Category),
  subcategory: Schema.optionalKey(Schema.NullOr(Subcategory)),
  colours: Schema.optionalKey(Colours),
})
export type UpdatePiece = typeof UpdatePiece.Type

export class PieceNotFound extends Schema.TaggedError<PieceNotFound>()('PieceNotFound', {}, { httpApiStatus: 404 }) {}

/** A photo Styld will not take, and why. */
export class UploadRefused extends Schema.TaggedError<UploadRefused>()(
  'UploadRefused',
  {
    reason: Schema.Literals([
      'notFound',
      'expired',
      'notReceived',
      'alreadyUsed',
      'tooLarge',
      'notAnImage',
      'wrongType',
    ]),
  },
  { httpApiStatus: 422 },
) {}

/** The subcategory belongs to another category. */
export class SubcategoryMismatch extends Schema.TaggedError<SubcategoryMismatch>()(
  'SubcategoryMismatch',
  {},
  { httpApiStatus: 422 },
) {}

/** The operation id was already used for a different change. */
export class OperationConflict extends Schema.TaggedError<OperationConflict>()(
  'OperationConflict',
  {},
  { httpApiStatus: 409 },
) {}

/** Storage did not answer; the request may be retried. */
export class WardrobeUnavailable extends Schema.TaggedError<WardrobeUnavailable>()(
  'WardrobeUnavailable',
  {},
  { httpApiStatus: 503 },
) {}
