import { landingMediaNames } from '@styld/protocol'
import { Effect, Option } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { Media } from './kernel/Media.ts'

// The signed-out Home's films and pictures (`@styld/protocol` › Landing.ts): public, the same for everyone, and named
// after their content, so they are cached for a year. Only the allowlisted names are read, each from `landing/<name>`
// in the stage's media bucket. Safari plays a video only from a server that answers byte ranges, so a single range
// gets its 206.

/** A byte range R2 reads: from `offset`, `length` bytes. */
interface ByteRange {
  readonly offset: number
  readonly length: number
}

/** What the route needs of a bucket: R2's binding has it, and so can a test's. */
export interface LandingBucket {
  head(key: string): Promise<{ readonly size: number; readonly httpEtag: string } | null>
  get(key: string, options?: { readonly range?: ByteRange }): Promise<{ readonly body: unknown } | null>
}

const allowed = new Set(landingMediaNames)

const contentTypes: Readonly<Record<string, string>> = { mp4: 'video/mp4', webp: 'image/webp' }

/** A year, and never revalidated: a changed file is uploaded under its old name only by the operator, who accepts a
 * stale copy until browsers drop it. */
const cacheControl = 'public, max-age=31536000, immutable'

/** One range of a `size`-byte file from a `Range` header: none for no header, several ranges or another unit (the
 * whole file answers), `unsatisfiable` for a range outside the file. */
const byteRange = (header: string | undefined, size: number): Option.Option<ByteRange | 'unsatisfiable'> => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '')
  if (match === null) return Option.none()
  const [, from = '', to = ''] = match
  if (from === '' && to === '') return Option.none()
  if (from === '') {
    const suffix = Math.min(Number(to), size)
    return suffix === 0 ? Option.some('unsatisfiable') : Option.some({ offset: size - suffix, length: suffix })
  }
  const offset = Number(from)
  if (offset >= size) return Option.some('unsatisfiable')
  const last = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  return last < offset ? Option.some('unsatisfiable') : Option.some({ offset, length: last - offset + 1 })
}

/** `GET /cdn/landing/:name`: a landing file, whole or one range of it.
 * @internal Exported for its tests. */
export const serveLandingFile = (bucket: LandingBucket) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest
    const name = decodeURIComponent(new URL(request.url, 'http://styld').pathname.slice('/cdn/landing/'.length))
    if (!allowed.has(name)) return HttpServerResponse.empty({ status: 404 })
    const key = `landing/${name}`
    const contentType = contentTypes[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream'
    const head = yield* Effect.tryPromise(() => bucket.head(key)).pipe(Effect.option)
    if (Option.isNone(head)) return HttpServerResponse.empty({ status: 503 })
    if (head.value === null) return HttpServerResponse.empty({ status: 404 })
    const { size, httpEtag } = head.value
    const headers = { etag: httpEtag, 'cache-control': cacheControl, 'accept-ranges': 'bytes' }
    if (request.headers['if-none-match'] === httpEtag) return HttpServerResponse.empty({ status: 304, headers })
    const range = byteRange(request.headers['range'], size)
    if (Option.contains(range, 'unsatisfiable'))
      return HttpServerResponse.empty({ status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } })
    const part = Option.filter(range, (value): value is ByteRange => value !== 'unsatisfiable')
    const object = yield* Effect.tryPromise(() =>
      bucket.get(key, Option.isSome(part) ? { range: part.value } : undefined),
    ).pipe(Effect.option)
    if (Option.isNone(object)) return HttpServerResponse.empty({ status: 503 })
    if (object.value === null) return HttpServerResponse.empty({ status: 404 })
    const body = object.value.body
    return Option.match(part, {
      onNone: () =>
        HttpServerResponse.raw(body, {
          status: 200,
          contentType,
          headers: { ...headers, 'content-length': String(size) },
        }),
      onSome: ({ offset, length }) =>
        HttpServerResponse.raw(body, {
          status: 206,
          contentType,
          headers: {
            ...headers,
            'content-length': String(length),
            'content-range': `bytes ${offset}-${offset + length - 1}/${size}`,
          },
        }),
    })
  })

/** The landing's file route, over the stage's media bucket. */
export const landingMediaRoute = Effect.map(Media, ({ bucket }) =>
  HttpRouter.add(
    'GET',
    '/cdn/landing/:name',
    serveLandingFile({ head: (key) => bucket.head(key), get: (key, options) => bucket.get(key, options) }),
  ),
)
