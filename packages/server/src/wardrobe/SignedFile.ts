import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { Media } from '../kernel/Media.ts'
import type { SignedGrant } from '../kernel/SignedMedia.ts'

/** One byte range, bounded by the stored object's actual length. Multiple or impossible ranges are refused.
 * @internal Exported for the focused range parser tests. */
export const byteRange = (header: string, size: number) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (match === null || size === 0) return undefined
  const first = match[1] ?? ''
  const last = match[2] ?? ''
  if (first === '' && last === '') return undefined
  const start = first === '' ? Math.max(0, size - Number(last)) : Number(first)
  const end = first === '' || last === '' ? size - 1 : Math.min(Number(last), size - 1)
  if (![start, end, Number(first), Number(last)].every(Number.isSafeInteger) || start < 0 || start > end)
    return undefined
  return { offset: start, length: end - start + 1 }
}

/** Only generated turn files have raw grants. Photos always pass through the metadata-stripping Images binding. */
export const signedFile = Effect.fnUntraced(function* (
  grant: SignedGrant,
  request: HttpServerRequest.HttpServerRequest,
  maxAge: number,
) {
  const contentType = grant.variant === 'turn-video' ? 'video/mp4' : 'image/png'
  if (grant.contentType !== contentType) return HttpServerResponse.empty({ status: 403 })
  const { bucket } = yield* Media
  const metadata = yield* Effect.tryPromise(() => bucket.head(grant.key))
  if (metadata === null) return HttpServerResponse.empty({ status: 404 })
  const headers = {
    'cache-control': `private, max-age=${maxAge}, immutable`,
    'accept-ranges': 'bytes',
    etag: metadata.httpEtag,
  }
  if (request.headers['if-none-match'] === metadata.httpEtag) return HttpServerResponse.empty({ status: 304, headers })
  const requested = request.headers.range
  const useRange =
    requested !== undefined &&
    (request.headers['if-range'] === undefined || request.headers['if-range'] === metadata.httpEtag)
  const range = useRange ? byteRange(requested, metadata.size) : undefined
  if (useRange && range === undefined)
    return HttpServerResponse.empty({
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${metadata.size}` },
    })
  const object = yield* Effect.tryPromise(() => bucket.get(grant.key, range === undefined ? undefined : { range }))
  if (object === null) return HttpServerResponse.empty({ status: 404 })
  return HttpServerResponse.raw(object.body, {
    contentType,
    status: range === undefined ? 200 : 206,
    headers: {
      ...headers,
      'content-length': String(range?.length ?? object.size),
      ...(range === undefined
        ? {}
        : { 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}` }),
    },
  })
})
