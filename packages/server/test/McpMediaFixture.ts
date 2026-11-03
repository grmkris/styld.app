import { Effect, Redacted } from 'effect'
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
