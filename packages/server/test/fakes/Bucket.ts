import { Layer } from 'effect'
import { Media } from '../../src/kernel/Media.ts'

/** Media over a map of stored objects: the bucket's get, put and delete, which cut-outs and drawings call. */
export const mediaOver = (stored: Map<string, Uint8Array>) => {
  const bucket = {
    get: async (key: string) => {
      const bytes = stored.get(key)
      return bytes === undefined ? null : { arrayBuffer: async () => bytes.slice().buffer }
    },
    put: async (key: string, bytes: Uint8Array) => void stored.set(key, bytes),
    delete: async (key: string) => void stored.delete(key),
  }
  // SAFETY: the fake implements the bucket get, put and delete that cut-outs and drawings call -- the rest of R2 and Images is never called by them
  return Layer.succeed(Media, Media.of({ bucket, images: {} } as never))
}
