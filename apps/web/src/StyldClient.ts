import type { StyldApi } from '@styld/protocol'
import { Context, Effect, Layer, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import type * as HttpApiClient from 'effect/http-api/HttpApiClient'

/** The API Worker refuses a mutation without this header, so a cross-site form cannot make one. */
export const csrfHeader = HttpClient.mapRequest(HttpClientRequest.setHeader('x-effect-auth-csrf', '1'))

/** A file's bytes did not get through to its upload. */
export class FileNotSent extends Schema.TaggedError<FileNotSent>()('FileNotSent', {
  /** The server looked at the bytes and refused them (415, or 413 when too large). */
  refused: Schema.Boolean,
}) {}

/** Styld's typed API, called from the browser. The session travels as a same-origin cookie. */
export class StyldClient extends Context.Service<
  StyldClient,
  {
    /** The typed client; its code loads the first time a page asks for it. */
    readonly api: Effect.Effect<HttpApiClient.ForApi<typeof StyldApi>>
    /** Send a photo's or video's bytes to the path `createUpload` or `createVideoUpload` returned. */
    readonly sendFile: (path: string, file: Blob) => Effect.Effect<void, FileNotSent>
  }
>()('@styld/web/StyldClient') {}

export const styldClientLayer = (origin: string) =>
  Layer.effect(
    StyldClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const api = yield* Effect.cached(
        Effect.promise(() => import('./StyldApiClient.ts')).pipe(
          Effect.flatMap(({ makeApi }) => makeApi(origin)),
          Effect.provideService(HttpClient.HttpClient, http),
        ),
      )
      const client = HttpClient.filterStatusOk(csrfHeader(http))
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
      }
    }),
  )
