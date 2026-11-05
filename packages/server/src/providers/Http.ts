import { Effect, Redacted } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { busy, outcomeUnknown, type ProviderError, reasonOfStatus } from './Errors.ts'

// The one HTTP client for the providers Styld reaches over the internet (Meta's SAM and Muse, Veo through the Vercel
// AI Gateway): the bearer key, the abort signal, pictures as base64, and how an answer that is not ok, or no answer at
// all, fails. Each adapter adds only its own paths, bodies and answers.

/** How a Worker fetches: the global `fetch`, or a test's. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** A provider's address, key and fetch, and the headers every request to it carries. */
export interface HttpProviderSettings {
  /** The provider's name, as errors and metrics record it. */
  readonly provider: string
  readonly base: string
  readonly key: Redacted.Redacted
  readonly fetch: Fetch
  readonly headers?: Readonly<Record<string, string>>
}

/** What a request that got no answer means: paid work the provider may have taken is `unknown`, and is never sent
 * again on its own; anything else (a free upload, a status, a delete) only did not get through. */
export type Lost = 'unknown' | 'busy'

/** A picture's bytes as base64, as JSON bodies carry them. */
export const base64Of = (bytes: Uint8Array) => Base64.encode(bytes)

/** A picture as a `data:` URL. */
export const dataUrl = (picture: { readonly bytes: Uint8Array; readonly contentType: string }) =>
  `data:${picture.contentType};base64,${base64Of(picture.bytes)}`

/** The client for one provider. */
export const httpProvider = (settings: HttpProviderSettings) => {
  const { provider } = settings
  const lostAs = (lost: Lost, cause?: unknown) =>
    lost === 'unknown' ? outcomeUnknown(provider, cause) : busy(provider, cause)
  const send = (
    path: string,
    init: {
      readonly method: 'GET' | 'POST' | 'DELETE'
      readonly lost: Lost
      readonly body?: BodyInit
      readonly contentType?: string
    },
  ): Effect.Effect<Response, ProviderError> =>
    Effect.tryPromise({
      try: (signal) =>
        settings.fetch(`${settings.base}${path}`, {
          method: init.method,
          headers: {
            authorization: `Bearer ${Redacted.value(settings.key)}`,
            ...(init.contentType === undefined ? {} : { 'content-type': init.contentType }),
            ...settings.headers,
          },
          ...(init.body === undefined ? {} : { body: init.body }),
          signal,
        }),
      // A request that got no answer: the fetch's own error (a lost connection, an abort), never the request.
      catch: (cause) => lostAs(init.lost, cause),
    })
  return {
    provider,
    send,
    /** POST a JSON body. */
    postJson: (path: string, body: unknown, lost: Lost) =>
      send(path, { method: 'POST', body: JSON.stringify(body), contentType: 'application/json', lost }),
    /** An answer that is not ok as the provider's refusal: throttling and server errors were not billed and may pass
     * later; any other would repeat. */
    refusal: (response: Response): Effect.Effect<never, ProviderError> =>
      Effect.fail(reasonOfStatus(provider, response.status)),
    /** A file the provider left at an address of its own, fetched without the key (it is not the provider's API);
     * one that cannot be fetched now is busy. */
    download: (url: string) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await settings.fetch(url, { method: 'GET', signal })
          if (!response.ok) throw new Error(String(response.status))
          return new Uint8Array(await response.arrayBuffer())
        },
        catch: (cause) => busy(provider, cause),
      }),
    /** An answer's JSON; a body that cannot be read fails as `lost`. */
    json: (response: Response, lost: Lost) =>
      Effect.tryPromise({ try: (): Promise<unknown> => response.json(), catch: () => lostAs(lost) }),
  }
}
export type HttpProvider = ReturnType<typeof httpProvider>
