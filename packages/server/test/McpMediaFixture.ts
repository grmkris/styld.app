import { languages } from '@styld/i18n'
import { type Piece, pieceMatches, type PieceFilter } from '@styld/protocol'
import { Effect, Option, Redacted } from 'effect'
import { SignedMedia } from '../src/kernel/SignedMedia.ts'
import type { ImageBindings } from '../src/wardrobe/Delivery.ts'
export const withThumbnail = <A>(value: A, pieceId: string) =>
  Effect.gen(function* () {
    yield* (yield* SignedMedia).address({
      entityId: pieceId,
      key: 'accounts/acc_1/thumbnail',
      contentType: 'image/png',
      variant: 'thumb',
      version: '1',
    })
    return value
  }).pipe(Effect.provide(SignedMedia.layer(Redacted.make('native-test-signing-secret-32-characters'))))
const unused = (): never => {
  throw new Error('unused image operation')
}
const output = {
  image: () => new Blob(['webp']).stream(),
  contentType: () => 'image/webp',
  response: unused,
}
const transformer = {
  transform: () => transformer,
  draw: unused,
  output: async () => output,
}
export const media = {
  bucket: { get: async () => ({ body: new Blob(['png']).stream() }) },
  images: { input: () => transformer },
} satisfies ImageBindings

/** The wardrobe's own search (`wardrobe/Search.ts`, protocol `PieceSearch.ts`) over these pieces, its read authorizing
 * the first piece's thumbnail as `withThumbnail` does. */
export const searchedWithThumbnail =
  (pieces: ReadonlyArray<Piece>) =>
  ({ filter, offset, limit }: { readonly filter: PieceFilter; readonly offset: number; readonly limit: number }) => {
    const found = pieces.filter((each) => pieceMatches(each, filter, languages))
    const end = offset + limit
    return withThumbnail(
      {
        pieces: found.slice(offset, end),
        total: found.length,
        nextOffset: end < found.length ? Option.some(end) : Option.none<number>(),
      },
      pieces[0]?.id ?? '',
    )
  }
