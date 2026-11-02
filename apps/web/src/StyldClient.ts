import type { StyldApi } from '@styld/protocol'
import { Context, Effect, Exit, Layer, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import type * as HttpApiClient from 'effect/http-api/HttpApiClient'

/** A file's bytes did not get through to its upload. */
export class FileNotSent extends Schema.TaggedError<FileNotSent>()('FileNotSent', {
  /** The server looked at the bytes and refused them (415, or 413 when too large). */
  refused: Schema.Boolean,
}) {}

/** A stored file could not be read back. */
export class FileNotRead extends Schema.TaggedError<FileNotRead>()('FileNotRead', {}) {}

/** The browser could not load the code for its API client; the next request may try again. */
export class ClientNotLoaded extends Schema.TaggedError<ClientNotLoaded>()('ClientNotLoaded', {}) {}

/** Share a load while it runs and keep only successful code loads. */
export const cachedClient = <A>(load: Effect.Effect<A, ClientNotLoaded>) =>
  Effect.cachedWithTTL(load, (exit) => (Exit.isSuccess(exit) ? 'Infinity' : 0))

/** Styld's typed API, called from the browser. The session travels as a same-origin cookie. */
export class StyldClient extends Context.Service<
  StyldClient,
  {
    /** The typed client; its code loads the first time a page asks for it. */
    readonly api: Effect.Effect<HttpApiClient.ForApi<typeof StyldApi>, ClientNotLoaded>
    /** Send a photo's or video's bytes to the path `createUpload` or `createVideoUpload` returned. */
    readonly sendFile: (path: string, file: Blob) => Effect.Effect<void, FileNotSent>
    /** Read one of the account's stored files from its same-origin path, such as a turn's video. */
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, FileNotRead>
  }
>()('@styld/web/StyldClient') {}

export const styldClientLayer = (origin: string) =>
  Layer.effect(
    StyldClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const api = yield* cachedClient(
        Effect.tryPromise({ try: () => import('./StyldApiClient.ts'), catch: () => ClientNotLoaded.make({}) }).pipe(
          Effect.flatMap(({ makeApi }) => makeApi(origin)),
          Effect.provideService(HttpClient.HttpClient, http),
        ),
      )
      const client = HttpClient.filterStatusOk(http)
      return {
        api,
        sendFile: (path, file) =>
          client
            .execute(
              HttpClientRequest.put(new URL(path, origin).toString()).pipe(
                HttpClientRequest.setBody(HttpBody.raw(file, { contentType: file.type, contentLength: file.size })),
              ),
            )
            .pipe(
              Effect.asVoid,
              Effect.mapError((error) =>
                FileNotSent.make({ refused: error.response?.status === 415 || error.response?.status === 413 }),
              ),
            ),
        readFile: (path) =>
          client.get(new URL(path, origin).toString()).pipe(
            Effect.flatMap((response) => response.arrayBuffer),
            Effect.map((buffer) => new Uint8Array(buffer)),
            Effect.mapError(() => FileNotRead.make({})),
          ),
      }
    }),
  )
