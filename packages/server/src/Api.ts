import { SessionHttp } from '@styld/auth/config'
import { StyldApi } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { AccountLifecycle } from './AccountLifecycle.ts'
import type { makeAuthHttp } from './AuthHttp.ts'
import { boardHandlers } from './boards/Http.ts'
import type { Boards } from './boards/Boards.ts'
import { captureHandlers } from './capture/Http.ts'
import type { Captures } from './capture/Service.ts'
import { generationHandlers } from './generation/Http.ts'
import type { Generations } from './generation/Service.ts'
import { linkHandlers } from './links/Http.ts'
import { lookHandlers } from './looks/Http.ts'
import type { Looks } from './looks/Looks.ts'
import { type Admit, admitWith, wardrobeHandlers } from './wardrobe/Http.ts'
import type { Wardrobe } from './wardrobe/Wardrobe.ts'
import { wornHandlers } from './worn/Http.ts'
import { profileHandlers } from './social/Http.ts'
import type { Profiles } from './social/Profiles.ts'
import type { Discovery } from './social/Discovery.ts'
import type { PublicPages } from './social/Public.ts'
import { type AllowRead, publicHandlers } from './social/PublicHttp.ts'
import type { Social } from './social/Social.ts'
import { socialHandlers } from './social/SocialHttp.ts'
import type { Worn } from './worn/Worn.ts'
import { StylistChats, stylistHandlers } from './stylist/Http.ts'
import { outfitHandlers } from './outfits/Http.ts'
import type { Outfits } from './outfits/Outfits.ts'
import { photoHandlers } from './photos/Http.ts'
import type { Photos } from './photos/Photos.ts'

const accountHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'account', (handlers) =>
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
            const { claims } = yield* SessionHttp.CurrentSession
            yield* admit(lifecycle.deleteAccount(claims.accountId))
          }),
        )
    }),
  )

/** The typed API's routes. Yielded's request middleware validates every request and its session
 * security implements `SessionHttp.RequireSession`. */
export const apiRoutes = (
  auth: ReturnType<typeof makeAuthHttp>,
  services: {
    readonly wardrobe: Layer.Layer<Wardrobe>
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
  limits: {
    readonly allowCheck: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>
    readonly allowLink: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>
    readonly allowGenerate: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>
    readonly allowRead: AllowRead
  },
) =>
  HttpApiBuilder.layer(StyldApi).pipe(
    Layer.provide(accountHandlers(admitWith(auth)).pipe(Layer.provide(services.lifecycle))),
    Layer.provide(wardrobeHandlers(admitWith(auth)).pipe(Layer.provide(services.wardrobe))),
    Layer.provide(captureHandlers(admitWith(auth), limits.allowCheck).pipe(Layer.provide(services.captures))),
    Layer.provide(lookHandlers(admitWith(auth)).pipe(Layer.provide(services.looks))),
    Layer.provide(boardHandlers(admitWith(auth)).pipe(Layer.provide(services.boards))),
    Layer.provide(wornHandlers(admitWith(auth)).pipe(Layer.provide(services.worn))),
    Layer.provide(profileHandlers(admitWith(auth)).pipe(Layer.provide(services.profiles))),
    Layer.provide(
      publicHandlers(auth, limits.allowRead).pipe(
        Layer.provide(Layer.mergeAll(services.publicPages, services.discovery)),
      ),
    ),
    Layer.provide(socialHandlers(admitWith(auth)).pipe(Layer.provide(services.social))),
    Layer.provide(linkHandlers(admitWith(auth), limits.allowLink).pipe(Layer.provide(services.wardrobe))),
    Layer.provide(generationHandlers(admitWith(auth), limits.allowGenerate).pipe(Layer.provide(services.generations))),
    Layer.provide(stylistHandlers(admitWith(auth)).pipe(Layer.provide(services.stylist))),
    Layer.provide(outfitHandlers(admitWith(auth)).pipe(Layer.provide(services.outfits))),
    Layer.provide(photoHandlers(admitWith(auth)).pipe(Layer.provide(services.photos))),
    Layer.provide(auth.router.securityLayer(SessionHttp)),
    auth.router.middleware,
    Layer.provide(auth.dependencies),
  )
