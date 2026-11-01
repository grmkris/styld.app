import type { Locale } from '@styld/i18n'
import { BoardImageId, PieceId, SlowDown, StyldApi } from '@styld/protocol'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Layer, Option, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type AuthHttp, sessionCookieAccount } from '../AuthHttp.ts'
import { type ShownImage, ShownSize } from '../wardrobe/Http.ts'
import { Discovery } from './Discovery.ts'
import { PublicPages } from './Public.ts'
import { pageMeta } from './PublicMeta.ts'

/** A per-network limit on public reads: false over the limit, or when the limiter fails. */
export type AllowRead = (client: string) => Effect.Effect<boolean, never, RuntimeContext>

const clientOf = Effect.map(HttpServerRequest, (request) => request.headers['cf-connecting-ip'] ?? 'unknown')

/** A link preview's language: Slovenian when the reader asks for it first, English otherwise (crawlers mostly
 * ask for nothing). */
const readerLocale = Effect.map(HttpServerRequest, (request): Locale =>
  (request.headers['accept-language'] ?? '').trim().toLowerCase().startsWith('sl') ? 'sl' : 'en',
)

/** A read past the network's limit is refused before it reaches D1. */
const limited =
  (allowRead: AllowRead) =>
  <A, E, R>(read: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (!(yield* allowRead(yield* clientOf))) return yield* SlowDown.make({})
      return yield* read
    })

/** The public pages' endpoints: anyone may read them, signed in or not, a few hundred times a minute. A signed-in
 * reader sees nothing of someone a block stands between. */
export const publicHandlers = (auth: AuthHttp, allowRead: AllowRead) =>
  HttpApiBuilder.group(StyldApi, 'public', (handlers) =>
    Effect.gen(function* () {
      const pages = yield* PublicPages
      const discovery = yield* Discovery
      const within = limited(allowRead)
      const reader = yield* sessionCookieAccount(auth)
      const read = <A, E, R>(page: (viewer: Option.Option<string>) => Effect.Effect<A, E, R>) =>
        within(Effect.flatMap(reader, page))
      return handlers
        .handle('profile', ({ params }) => read((viewer) => pages.profile(params.handle, viewer)))
        .handle('board', ({ params }) => read((viewer) => pages.board(params.boardId, viewer)))
        .handle('look', ({ params }) => read((viewer) => pages.look(params.lookId, viewer)))
        .handle('piece', ({ params }) => read((viewer) => pages.piece(params.pieceId, viewer)))
        .handle('explore', ({ query }) => read((viewer) => discovery.explore(Option.fromNullishOr(query.mood), viewer)))
        .handle('search', ({ query }) => read((viewer) => discovery.search(query.q, viewer)))
        .handle('meta', ({ query }) =>
          within(Effect.flatMap(readerLocale, (locale) => pageMeta(pages, query.path, locale))),
        )
    }),
  )

const PieceTarget = Schema.Struct({ pieceId: PieceId, size: ShownSize })
const PictureTarget = Schema.Struct({ imageId: BoardImageId, size: ShownSize })

/** A public image route: anyone may load it while its page is public; revalidated on every view, so going
 * private or failing a check takes it down at once. */
const publicImage = <A, I extends Readonly<Record<string, string | undefined>>>(
  allowRead: AllowRead,
  target: Schema.ConstraintCodec<A, I, never, unknown>,
  find: (target: A) => Effect.Effect<Option.Option<ShownImage>, unknown>,
) =>
  Effect.gen(function* () {
    if (!(yield* allowRead(yield* clientOf))) return HttpServerResponse.empty({ status: 429 })
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
export const publicImageRoutes = (allowRead: AllowRead) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const pages = yield* PublicPages
      return Layer.mergeAll(
        HttpRouter.add(
          'GET',
          '/cdn/public/pieces/:pieceId/:size',
          publicImage(allowRead, PieceTarget, ({ pieceId, size }) => pages.pieceImage(pieceId, size)),
        ),
        HttpRouter.add(
          'GET',
          '/cdn/public/pictures/:imageId/:size',
          publicImage(allowRead, PictureTarget, ({ imageId, size }) => pages.pictureImage(imageId, size)),
        ),
      )
    }),
  )
