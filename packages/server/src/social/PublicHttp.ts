import { BoardImageId, PieceId, SlowDown, StyldApi } from '@styld/protocol'
import { Effect, Layer, Option, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type AuthHttp, sessionCookieAccount } from '../AuthHttp.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import { ShownSize } from '../wardrobe/Media.ts'
import { networkOf, Pacing } from '../kernel/Pacing.ts'
import { Discovery } from './Discovery.ts'
import { PublicPages } from './Public.ts'
import { pageMeta } from './PublicMeta.ts'
import { asReader, ReaderLocale } from './Translated.ts'

/** Whether the reader's network is within its `publicRead` pace. */
const readable = Effect.gen(function* () {
  const pacing = yield* Pacing
  return Effect.flatMap(HttpServerRequest, (request) => pacing.allows('publicRead', networkOf(request.headers)))
})

/** A read past the network's pace is refused before it reaches D1. */
const limited =
  (allowed: Effect.Effect<boolean, never, HttpServerRequest>) =>
  <A, E, R>(read: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (!(yield* allowed)) return yield* SlowDown.make({})
      return yield* read
    })

/** The public pages' endpoints: anyone may read them, signed in or not, a few hundred times a minute. A signed-in
 * reader sees nothing of someone a block stands between. */
export const publicHandlers = (auth: AuthHttp) =>
  HttpApiBuilder.group(StyldApi, 'public', (handlers) =>
    Effect.gen(function* () {
      const pages = yield* PublicPages
      const discovery = yield* Discovery
      const within = limited(yield* readable)
      const reader = yield* sessionCookieAccount(auth)
      const read = <A, E, R>(page: (viewer: Option.Option<string>) => Effect.Effect<A, E, R>) =>
        within(asReader(Effect.flatMap(reader, page)))
      return (
        handlers
          .handle('profile', ({ params }) => read((viewer) => pages.profile(params.handle, viewer)))
          .handle('board', ({ params }) => read((viewer) => pages.board(params.boardId, viewer)))
          .handle('look', ({ params }) => read((viewer) => pages.look(params.lookId, viewer)))
          .handle('piece', ({ params }) => read((viewer) => pages.piece(params.pieceId, viewer)))
          .handle('explore', ({ query }) =>
            read((viewer) => discovery.explore(Option.fromNullishOr(query.mood), viewer)),
          )
          .handle('search', ({ query }) => read((viewer) => discovery.search(query.q, viewer)))
          // The preview is read as the page is: a block hides its title and pictures too (the edge forwards the cookie).
          .handle('meta', ({ query }) =>
            read((viewer) => Effect.flatMap(ReaderLocale, (locale) => pageMeta(pages, query.path, locale, viewer))),
          )
      )
    }),
  )

const PieceTarget = Schema.Struct({ pieceId: PieceId, size: ShownSize })
const PictureTarget = Schema.Struct({ imageId: BoardImageId, size: ShownSize })

/** A public image route: anyone may load it while its page is public; revalidated on every view, so going
 * private or failing a check takes it down at once. */
const publicImage = <A, I extends Readonly<Record<string, string | undefined>>>(
  allowed: Effect.Effect<boolean, never, HttpServerRequest>,
  target: Schema.ConstraintCodec<A, I, never, unknown>,
  find: (target: A) => Effect.Effect<Option.Option<ShownImage>, unknown>,
) =>
  Effect.gen(function* () {
    if (!(yield* allowed)) return HttpServerResponse.empty({ status: 429 })
    const params = yield* HttpRouter.schemaPathParams(target).pipe(Effect.option)
    if (Option.isNone(params)) return HttpServerResponse.empty({ status: 404 })
    const request = yield* HttpServerRequest
    const shown = yield* find(params.value).pipe(Effect.option)
    if (Option.isNone(shown)) return HttpServerResponse.empty({ status: 503 })
    if (Option.isNone(shown.value)) return HttpServerResponse.empty({ status: 404 })
    const { body, contentType, version } = shown.value.value
    const etag = `"${version}"`
    const headers = { etag, 'cache-control': 'public, no-cache' }
    return request.headers['if-none-match'] === etag
      ? HttpServerResponse.empty({ status: 304, headers })
      : HttpServerResponse.raw(body, { status: 200, contentType, headers })
  })

/** `GET /cdn/public/pieces/:pieceId/:size` and `GET /cdn/public/pictures/:imageId/:size`: what public pages show. */
export const publicImageRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const pages = yield* PublicPages
    const allowed = yield* readable
    return Layer.mergeAll(
      HttpRouter.add(
        'GET',
        '/cdn/public/pieces/:pieceId/:size',
        publicImage(allowed, PieceTarget, ({ pieceId, size }) => pages.pieceImage(pieceId, size)),
      ),
      HttpRouter.add(
        'GET',
        '/cdn/public/pictures/:imageId/:size',
        publicImage(allowed, PictureTarget, ({ imageId, size }) => pages.pictureImage(imageId, size)),
      ),
    )
  }),
)
