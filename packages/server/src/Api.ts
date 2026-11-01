import { SessionHttp } from '@styld/auth/config'
import { CurrentAccount, StyldApi } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { AccountLifecycle } from './AccountLifecycle.ts'
import type { AuthHttp } from './AuthHttp.ts'
import { sessionAccountLayer, yieldedAdmission } from './SessionAccount.ts'
import { boardHandlers } from './boards/Http.ts'
import type { Boards } from './boards/Boards.ts'
import { captureHandlers } from './capture/Http.ts'
import type { Captures } from './capture/Service.ts'
import { generationHandlers } from './generation/Http.ts'
import type { Generations } from './generation/Service.ts'
import { linkHandlers } from './links/Http.ts'
import type { Links } from './links/Links.ts'
import type { Pacing } from './kernel/Pacing.ts'
import { lookHandlers } from './looks/Http.ts'
import type { Looks } from './looks/Looks.ts'
import { wardrobeHandlers } from './wardrobe/Http.ts'
import type { Wardrobe } from './wardrobe/Wardrobe.ts'
import { wornHandlers } from './worn/Http.ts'
import { profileHandlers } from './social/Http.ts'
import type { Profiles } from './social/Profiles.ts'
import type { Discovery } from './social/Discovery.ts'
import type { PublicPages } from './social/Public.ts'
import { publicHandlers } from './social/PublicHttp.ts'
import type { Social } from './social/Social.ts'
import { socialHandlers } from './social/SocialHttp.ts'
import type { Worn } from './worn/Worn.ts'
import { StylistChats, stylistHandlers } from './stylist/Http.ts'
import { outfitHandlers } from './outfits/Http.ts'
import type { Outfits } from './outfits/Outfits.ts'
import { photoHandlers } from './photos/Http.ts'
import type { Photos } from './photos/Photos.ts'

const accountHandlers = HttpApiBuilder.group(StyldApi, 'account', (handlers) =>
  Effect.gen(function* () {
    const lifecycle = yield* AccountLifecycle
    return handlers
      .handle(
        'me',
        Effect.fn('Styld.Api.account.me')(function* () {
          const { claims } = yield* SessionHttp.CurrentSession
          return { accountId: claims.accountId, displayName: claims.displayName, email: claims.email }
        }),
      )
      .handle(
        'deleteMe',
        Effect.fn('Styld.Api.account.deleteMe')(function* () {
          const { accountId } = yield* CurrentAccount
          yield* lifecycle.deleteAccount(accountId)
        }),
      )
  }),
)

/** The typed API's routes. Yielded's request middleware validates every request, its session security implements
 * `SessionHttp.RequireSession`, and `SessionAccount` makes the session the operations' `CurrentAccount`. */
export const apiRoutes = (
  auth: AuthHttp,
  services: {
    readonly wardrobe: Layer.Layer<Wardrobe>
    readonly links: Layer.Layer<Links>
    readonly pacing: Layer.Layer<Pacing>
    readonly lifecycle: Layer.Layer<AccountLifecycle>
    readonly captures: Layer.Layer<Captures>
    readonly looks: Layer.Layer<Looks>
    readonly boards: Layer.Layer<Boards>
    readonly worn: Layer.Layer<Worn>
    readonly profiles: Layer.Layer<Profiles>
    readonly publicPages: Layer.Layer<PublicPages>
    readonly discovery: Layer.Layer<Discovery>
    readonly social: Layer.Layer<Social>
    readonly generations: Layer.Layer<Generations>
    readonly stylist: Layer.Layer<StylistChats>
    readonly outfits: Layer.Layer<Outfits>
    readonly photos: Layer.Layer<Photos>
  },
) =>
  HttpApiBuilder.layer(StyldApi).pipe(
    Layer.provide(accountHandlers.pipe(Layer.provide(services.lifecycle))),
    Layer.provide(wardrobeHandlers.pipe(Layer.provide(services.wardrobe))),
    Layer.provide(captureHandlers.pipe(Layer.provide(services.captures))),
    Layer.provide(lookHandlers.pipe(Layer.provide(services.looks))),
    Layer.provide(boardHandlers.pipe(Layer.provide(services.boards))),
    Layer.provide(wornHandlers.pipe(Layer.provide(services.worn))),
    Layer.provide(profileHandlers.pipe(Layer.provide(services.profiles))),
    Layer.provide(
      publicHandlers(auth).pipe(
        Layer.provide(Layer.mergeAll(services.publicPages, services.discovery, services.pacing)),
      ),
    ),
    Layer.provide(socialHandlers.pipe(Layer.provide(services.social))),
    Layer.provide(linkHandlers.pipe(Layer.provide(services.links))),
    Layer.provide(generationHandlers.pipe(Layer.provide(services.generations))),
    Layer.provide(stylistHandlers.pipe(Layer.provide(services.stylist))),
    Layer.provide(outfitHandlers.pipe(Layer.provide(services.outfits))),
    Layer.provide(photoHandlers.pipe(Layer.provide(services.photos))),
    Layer.provide(sessionAccountLayer(yieldedAdmission(auth))),
    Layer.provide(auth.router.securityLayer(SessionHttp)),
    auth.router.middleware,
    Layer.provide(auth.dependencies),
  )
